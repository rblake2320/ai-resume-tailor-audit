import { describe, expect, it, vi } from "vitest";
import { generateLocalTailor, localResultJsonSchema } from "./local-tailor";

const input = { resume: "Original TypeScript experience", jobDescription: "TypeScript role", jobTitle: "", company: "", emphasis: "balanced" as const };
const result = { match_score_before: 40, match_score_after: 65, score_rationale: "Illustrative", changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [], requirement_evidence: [], ats_checks: [], tailored_resume_markdown: "# Candidate\nOriginal TypeScript experience", cover_letter_markdown: "Dear Hiring Team,\nOriginal TypeScript experience" };
const response = (overrides = {}) => Response.json({ model: "qwen3-vl:8b-instruct", done: true, done_reason: "stop", message: { role: "assistant", content: JSON.stringify(result) }, ...overrides });
describe("free local tailoring", () => {
  it("uses only the fixed installed local provider with bounded output and runtime validation", async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    expect(await generateLocalTailor(input, AbortSignal.timeout(1000), fetcher)).toMatchObject(result);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(init.body); expect(body.model).toBe("qwen3-vl:8b-instruct"); expect(body.options.num_predict).toBe(3072);
    expect(body.format).toEqual(localResultJsonSchema()); expect(JSON.stringify(body.format)).not.toMatch(/maxLength|minLength/);
    expect(init.redirect).toBe("error"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects truncation, empty content, wrong model, malformed shape and never retries", async () => {
    for (const overrides of [{ done_reason: "length" }, { done: false }, { model: "other" }, { message: { role: "assistant", content: "" } }, { message: { role: "assistant", content: "{}" } }]) {
      const fetcher = vi.fn().mockResolvedValue(response(overrides));
      await expect(generateLocalTailor(input, AbortSignal.timeout(1000), fetcher)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("refuses oversized input before transport and contains provider errors", async () => {
    const fetcher = vi.fn();
    await expect(generateLocalTailor({ ...input, resume: "r".repeat(12001) }, AbortSignal.timeout(1000), fetcher)).rejects.toThrow(/12,000/); expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(new Response("private provider diagnostic", { status: 502 }));
    await expect(generateLocalTailor(input, AbortSignal.timeout(1000), fetcher)).rejects.toThrow(/temporarily unavailable/);
  });
  it("admits one inference at a time and releases the slot after abort", async () => {
    const controller = new AbortController();
    const pending = generateLocalTailor(input, controller.signal, vi.fn((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }))) as typeof fetch);
    await expect(generateLocalTailor(input, AbortSignal.timeout(1000), vi.fn())).rejects.toThrow(/another request/);
    controller.abort(); await expect(pending).rejects.toThrow(/cancelled/);
    expect(await generateLocalTailor(input, AbortSignal.timeout(1000), vi.fn().mockResolvedValue(response()))).toMatchObject(result);
  });
});
