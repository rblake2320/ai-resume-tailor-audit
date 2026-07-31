import { describe, expect, it, vi } from "vitest";
import { HttpLimitError, readJsonBody, readResponseText } from "./http-limits";

function streamingRequest(headers: Record<string, string>) {
  const cancel = vi.fn();
  const pull = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull, cancel });
  const request = new Request("https://app.test/api", {
    method: "POST", headers, body, duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, cancel, pull };
}

describe("bounded HTTP bodies", () => {
  it("rejects declared and streamed JSON bodies beyond the limit", async () => {
    const declared = new Request("https://app.test/api", {
      method: "POST", headers: { "content-type": "application/json", "content-length": "100" }, body: "{}",
    });
    await expect(readJsonBody(declared, 10)).rejects.toMatchObject({ status: 413 });

    const streamed = new Request("https://app.test/api", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(100) }),
    });
    await expect(readJsonBody(streamed, 10)).rejects.toBeInstanceOf(HttpLimitError);
  });

  it("requires JSON content type and valid JSON", async () => {
    await expect(readJsonBody(new Request("https://app.test", { method: "POST", body: "{}" }), 10))
      .rejects.toMatchObject({ status: 415 });
    await expect(readJsonBody(new Request("https://app.test", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }), 10))
      .rejects.toMatchObject({ status: 400 });
  });

  it("cancels bodies rejected from content type or declared length headers", async () => {
    const cases: Array<{ headers: Record<string, string>; status: number }> = [
      { headers: {}, status: 415 },
      { headers: { "content-type": "text/plain" }, status: 415 },
      { headers: { "content-type": "application/json", "content-length": "not-a-number" }, status: 400 },
      { headers: { "content-type": "application/json", "content-length": "-1" }, status: 400 },
      { headers: { "content-type": "application/json", "content-length": "11" }, status: 413 },
    ];
    for (const { headers, status } of cases) {
      const { request, cancel } = streamingRequest(headers);
      await expect(readJsonBody(request, 10)).rejects.toMatchObject({ status });
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it("does not double-cancel streamed limits or cancel a valid body", async () => {
    const streamedCancel = vi.fn();
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(11))); },
      cancel: streamedCancel,
    });
    const oversized = new Request("https://app.test/api", {
      method: "POST", headers: { "content-type": "application/json" }, body: streamed, duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readJsonBody(oversized, 10)).rejects.toMatchObject({ status: 413 });
    expect(streamedCancel).toHaveBeenCalledOnce();

    const validCancel = vi.fn();
    const valid = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("{}")); controller.close(); },
      cancel: validCancel,
    });
    const accepted = new Request("https://app.test/api", {
      method: "POST", headers: { "content-type": "application/json" }, body: valid, duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readJsonBody(accepted, 10)).resolves.toEqual({});
    expect(validCancel).not.toHaveBeenCalled();
  });

  it("stops reading oversized remote responses", async () => {
    const response = new Response("x".repeat(100), { headers: { "content-type": "text/html" } });
    await expect(readResponseText(response, 10)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects malformed remote Content-Length instead of ignoring it", async () => {
    const response = new Response("{}", { headers: { "content-length": "not-a-number" } });
    await expect(readResponseText(response, 10)).rejects.toMatchObject({ status: 400 });
  });
});
