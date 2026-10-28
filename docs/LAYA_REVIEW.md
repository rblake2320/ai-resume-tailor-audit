# Optional local requirement review

Reviewed September 30, 2026. Laya is a classification model, so its useful role
here is suggesting whether a short English job excerpt is mandatory, preferred,
a responsibility, or logistics. It receives structured public job excerpts,
never screenshots, resumes, candidate evidence, or application packets.

The operator CLI is experimental and advisory. It has no authority to change
the web app's scores, validate career evidence, approve disclosure, or submit
an application. The web server does not load it or call an additional provider.

Install the optional runtime into a dedicated Python environment:

```powershell
python -m venv .venv-laya
.venv-laya\Scripts\python -m pip install -r scripts/requirements-laya.txt
```

Provision the exact `convaiinnovations/laya` English root checkpoint separately
using the official Hugging Face download tools. The CLI requires cached weights
and forces Hugging Face/Transformers offline mode; missing weights produce an
error rather than a download. Set `HF_HOME` to your existing cache if necessary.

```powershell
.venv-laya\Scripts\python scripts/laya-requirement-review.py --input scripts/testdata/laya-requirements.json --output laya-review.json
```

Input is a JSON array of `{ "text": "short public job excerpt" }` objects.
An optional `expected` category enables evaluation. Batches are limited to
40 excerpts and 32 KB, each excerpt to 500 characters, and tokenized
excerpt/question pairs to a conservative 240-token budget. Longer input fails
explicitly rather than silently truncating the document. Reports are atomically
published and include the checkpoint revision, runtime version, UTC timestamp,
input hash, latency, suggestions and probabilities.

The retained [CPU benchmark](evidence/2026-09-30/laya-benchmark.json) classified
10/12 synthetic requirements correctly. Salary and travel were misclassified;
this small balanced fixture is a smoke evaluation, not a representative
accuracy guarantee. Review every suggestion. The runtime emitted an invalid
temperature warning retained in `laya-runtime.txt`; probabilities are explicitly
marked uncalibrated. `action.act_probability` is not used.

Primary references: [model card](https://huggingface.co/convaiinnovations/laya),
[runtime source](https://github.com/NandhaKishorM/laya). The model card describes
the root checkpoint's English-only context budget and calibration limitations.
