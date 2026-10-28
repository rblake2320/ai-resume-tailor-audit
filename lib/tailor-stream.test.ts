import { describe, expect, it, vi } from "vitest";
import { readTailorStream, TAILOR_EVENT_MAX_CHARS, TAILOR_STREAM_MAX_BYTES } from "./tailor-stream";

const result = {
  match_score_before: 30, match_score_after: 55, score_rationale: "Estimate based on supplied evidence.",
  changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [],
  requirement_evidence: [], ats_checks: [], tailored_resume_markdown: "# José Example",
  cover_letter_markdown: "Dear Hiring Manager,",
};
function stream(chunks: Uint8Array[], cancel = vi.fn()) {
  return new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); }, cancel });
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const completed = (text: string) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });

describe("untrusted generation stream", () => {
  it("handles UTF-8 split across chunks and cancels after a validated result", async () => {
    const bytes = encode({ type: "result", data: result });
    const cancel = vi.fn();
    expect(await readTailorStream(stream([...bytes].map((byte) => new Uint8Array([byte])).concat([new Uint8Array([10])]), cancel), vi.fn())).toEqual(result);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("flushes the last event even without a trailing newline", async () => {
    expect(await readTailorStream(completed(JSON.stringify({ type: "result", data: result })), vi.fn())).toEqual(result);
  });
  it("reports progress before the final result", async () => {
    const progress = vi.fn();
    await readTailorStream(completed(`${JSON.stringify({ type: "progress", chars: 450 })}\n${JSON.stringify({ type: "result", data: result })}\n`), progress);
    expect(progress).toHaveBeenCalledWith(450);
  });
  it.each([null, { type: "result", data: {} }, { type: "progress", chars: -1 }, { type: "unknown" }, { type: "result", data: { ...result, match_score_after: 101 } }])("withholds malformed events: %j", async (event) => {
    const cancel = vi.fn();
    await expect(readTailorStream(stream([encode(event), new Uint8Array([10])], cancel), vi.fn())).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects invalid UTF-8", async () => {
    await expect(readTailorStream(stream([new Uint8Array([0xff])]), vi.fn())).rejects.toThrow();
  });
  it("bounds an unterminated event", async () => {
    await expect(readTailorStream(stream([new TextEncoder().encode("x".repeat(TAILOR_EVENT_MAX_CHARS + 1))]), vi.fn())).rejects.toThrow(/size limit/);
  });
  it("bounds accumulated responses", async () => {
    await expect(readTailorStream(stream([new Uint8Array(TAILOR_STREAM_MAX_BYTES + 1)]), vi.fn())).rejects.toThrow(/size limit/);
  });
  it("fails clearly on truncated streams and provider errors", async () => {
    await expect(readTailorStream(completed('{"type":'), vi.fn())).rejects.toThrow(/malformed/);
    await expect(readTailorStream(completed('{"type":"progress","chars":0}\n'), vi.fn())).rejects.toThrow(/unexpectedly/);
    await expect(readTailorStream(completed('{"type":"error","message":"Draft withheld"}\n'), vi.fn())).rejects.toThrow("Draft withheld");
  });
});
