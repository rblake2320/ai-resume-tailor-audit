import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { providerFetch, providerJson } from "./provider-http";

const servers: Server[] = [];
async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind.");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("provider HTTP real local transport", () => {
  it("rejects redirect before transmitting a synthetic OAuth body to another endpoint", async () => {
    let received = 0;
    const target = await fixture((_req, res) => { received += 1; res.end("{}"); });
    const source = await fixture((_req, res) => { res.writeHead(307, { location: target }); res.end(); });
    await expect(providerFetch(source, { method: "POST", body: "synthetic-no-secret" })).rejects.toThrow();
    expect(received).toBe(0);
  });
  it("rejects an actual oversized chunked response without Content-Length", async () => {
    const source = await fixture((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write('"'); res.end("x".repeat(2_048) + '"'); });
    const response = await providerFetch(source, {});
    await expect(providerJson(response, 1_024)).rejects.toThrow(/too large/);
  });
  it("aborts an actual upstream that never returns headers at the 15 second deadline", async () => {
    const source = await fixture(() => undefined);
    const started = performance.now();
    await expect(providerFetch(source, {})).rejects.toThrow();
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(14_000);
    expect(elapsed).toBeLessThan(18_000);
  }, 20_000);
});
