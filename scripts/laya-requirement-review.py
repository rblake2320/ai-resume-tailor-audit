"""Optional local English requirement triage; never an evidence or application gate."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import tempfile
import time

# Load only an already-cached exact checkpoint. No implicit network downloads.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["USE_TF"] = "0"

MODEL = "convaiinnovations/laya"
CRITERIA = {
    "mandatory": "Required qualification, must have or minimum requirement.",
    "preferred": "Optional qualification, preferred or nice to have.",
    "responsibility": "Work duties performed in the job.",
    "logistics": "Location, schedule, travel or compensation.",
}
QUESTIONS = {"category": {"type": "choice", "instructions": "Classify this job requirement.", "criteria": CRITERIA}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="JSON array of short public English job excerpts; never a resume")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    args = parser.parse_args()
    with args.input.open("rb") as handle:
        raw = handle.read(32_001)
    if len(raw) > 32_000:
        parser.error("Input exceeds 32 KB; split the requirements into smaller batches.")
    rows = json.loads(raw)
    if not isinstance(rows, list) or not 1 <= len(rows) <= 40:
        parser.error("Input must be an array of 1–40 excerpts.")
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get("text"), str)
                or not row["text"].strip() or len(row["text"]) > 500):
            parser.error("Every excerpt needs nonempty text of at most 500 characters; long documents are rejected, never truncated.")
        if "expected" in row and row["expected"] not in CRITERIA:
            parser.error("Unknown expected category.")
    import laya
    from huggingface_hub import snapshot_download
    started = time.perf_counter()
    snapshot = snapshot_download(MODEL, local_files_only=True,
                                 allow_patterns=["rl_agent_config.json", "model.safetensors", "tokenizer/*", "encoder/*"])
    agent = laya.load(snapshot, device=args.device)
    loaded = time.perf_counter()
    results = []
    for row in rows:
        # Runtime token budgets include the question/options, not just the excerpt.
        tokens = agent.tok.encode(json.dumps({"document": row["text"]}) + json.dumps(QUESTIONS))
        if len(tokens) > 240:
            parser.error("Excerpt plus question exceeds conservative 240-token budget; shorten it before review.")
        tick = time.perf_counter()
        answer = agent.predict({"document": row["text"]}, QUESTIONS)["answers"]["category"]
        category = answer.get("choice")
        if category not in CRITERIA:
            raise ValueError("Laya returned an unknown category; no report was published.")
        results.append({"text": row["text"], "suggestedCategory": category,
                        "expected": row.get("expected"), "probabilities": answer.get("probabilities"),
                        "latencyMs": round((time.perf_counter() - tick) * 1000, 2)})
    labeled = [row for row in results if row["expected"] is not None]
    correct = sum(row["suggestedCategory"] == row["expected"] for row in labeled)
    report = {"model": MODEL, "runtimeVersion": importlib.metadata.version("laya"),
              "checkpointRevision": Path(snapshot).name,
              "reviewedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "inputSha256": hashlib.sha256(raw).hexdigest(), "device": args.device,
              "loadMs": round((loaded - started) * 1000, 2),
              "advisoryOnly": True, "confidenceCalibrated": False,
              "correct": correct, "labeled": len(labeled), "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent, delete=False) as handle:
            name = handle.name
            json.dump(report, handle, indent=2, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, args.output)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)
    print(json.dumps({"model": MODEL, "correct": correct, "labeled": len(labeled), "output": str(args.output)}))


if __name__ == "__main__":
    main()

