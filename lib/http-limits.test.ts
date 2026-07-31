import { describe, expect, it } from "vitest";
import { HttpLimitError, readJsonBody, readResponseText } from "./http-limits";

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

  it("stops reading oversized remote responses", async () => {
    const response = new Response("x".repeat(100), { headers: { "content-type": "text/html" } });
    await expect(readResponseText(response, 10)).rejects.toMatchObject({ status: 413 });
  });
});
