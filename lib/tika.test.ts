import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentExtractionError, extractWithTika, TIKA_ENDPOINT } from "./tika";
const bytes = new Uint8Array([1, 2, 3]);
const metadata = { "Content-Type": "application/pdf", "tk:content": "Candidate résumé evidence" };
afterEach(() => vi.restoreAllMocks());
describe("private Tika extraction boundary", () => {
  it("sends bytes to only the fixed local endpoint and returns text without document metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...metadata, "dc:creator": "private author" }));
    expect(await extractWithTika(bytes, "pdf", AbortSignal.timeout(1000), fetcher)).toBe(metadata["tk:content"]);
    expect(fetcher.mock.calls[0][0]).toBe(TIKA_ENDPOINT);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "PUT", redirect: "error", headers: { "content-type": "application/octet-stream", accept: "application/json" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([{"tk:task-deadline-reached":true},{"tk:exception:runtime":"private path"},{"tk:write-limit-reached":true},{"tk:content":""},{"Content-Type":"application/zip"}])("rejects empty, disguised and incomplete HTTP200 extraction %j", async (override) => {
    await expect(extractWithTika(bytes, "pdf", AbortSignal.timeout(1000), vi.fn().mockResolvedValue(Response.json({ ...metadata, ...override })))).rejects.toBeInstanceOf(DocumentExtractionError);
  });
  it("bounds response size, contains unavailable parser diagnostics and never retries", async () => {
    for (const response of [new Response("private exception",{status:500}),new Response("private failure",{status:200}),Response.json({...metadata,"tk:content":"x".repeat(100001)}),Response.json(metadata,{headers:{"content-length":"600000"}})]) {
      const fetcher=vi.fn().mockResolvedValue(response);
      await expect(extractWithTika(bytes,"pdf",AbortSignal.timeout(1000),fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("refuses unsupported input before transport", async () => {
    const fetcher=vi.fn();await expect(extractWithTika(bytes,"zip",AbortSignal.timeout(1000),fetcher)).rejects.toThrow(/Unsupported/);expect(fetcher).not.toHaveBeenCalled();
  });
});
