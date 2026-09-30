import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ stream: vi.fn(), finalMessage: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    beta = { messages: { stream: provider.stream } };
  }
  return { default: Anthropic };
});
vi.mock("./durable-rate-limit", () => ({ enforcePublicRateLimit: () => null }));
import { POST } from "../app/api/tailor/route";

const result = {
  match_score_before: 50, match_score_after: 65, score_rationale: "Evidence-based estimate.",
  changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [],
  requirement_evidence: [], ats_checks: [], tailored_resume_markdown: "# Example Candidate",
  cover_letter_markdown: "Dear Hiring Manager, I built reliable systems.",
};
function request(signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/tailor", { method: "POST", signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify({
      resume: "Software engineer with experience building reliable applications. Designed services, improved testing, documented releases, supported customers, reviewed changes, maintained delivery pipelines, analyzed operational incidents, collaborated with product managers, and developed accessible interfaces. Education includes computer science and applied mathematics. Skills include TypeScript, Python, SQL, and technical writing.",
      jobDescription: "We seek a software engineer to develop reliable applications, collaborate with product managers, review code, improve testing, document releases, and maintain accessible interfaces using TypeScript and SQL.",
    }) });
}
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-test-key");
  provider.stream.mockReturnValue({
    async *[Symbol.asyncIterator]() { yield { type: "content_block_delta", delta: { type: "text_delta", text: "progress" } }; },
    finalMessage: provider.finalMessage,
  });
  provider.finalMessage.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(result) }] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("tailoring completion boundary", () => {
  it("returns an evidence-checked completed draft", async () => {
    const events = (await (await POST(request())).text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ type: "result", data: result });
  });
  it.each(["max_tokens", "model_context_window_exceeded", "pause_turn", "tool_use", null])(
    "withholds even valid JSON when the provider stopped with %s", async (stop_reason) => {
      provider.finalMessage.mockResolvedValue({ stop_reason, content: [{ type: "text", text: JSON.stringify(result) }] });
      const body = await (await POST(request())).text();
      expect(body).not.toContain('"type":"result"');
      expect(body).toContain('"type":"error"');
    });
  it("withholds empty documents and impossible match scores", async () => {
    provider.finalMessage.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ ...result, match_score_after: 1000, tailored_resume_markdown: " " }) }] });
    expect(await (await POST(request())).text()).not.toContain('"type":"result"');
  });
  it("disables automatic retries of costly generation", async () => {
    await (await POST(request())).text();
    expect(provider.stream.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
  });
  it("never starts a provider call for an already aborted request", async () => {
    const abort = new AbortController(); abort.abort();
    await (await POST(request(abort.signal))).text();
    expect(provider.stream).not.toHaveBeenCalled();
  });
  it("aborts upstream work when the response consumer disconnects", async () => {
    provider.finalMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      const signal = provider.stream.mock.calls[0][1].signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const response = await POST(request());
    await response.body!.cancel();
    expect(provider.stream.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("aborts upstream work at the server deadline", async () => {
    vi.useFakeTimers();
    try {
      provider.finalMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => {
        const signal = provider.stream.mock.calls[0][1].signal as AbortSignal;
        signal.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
      }));
      const response = await POST(request());
      const body = response.text();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(await body).toContain('"type":"error"');
      expect(provider.stream.mock.calls[0][1].signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
