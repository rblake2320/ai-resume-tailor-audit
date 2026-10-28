import { createServer } from "node:http";
import type { LookupFunction } from "node:net";
import { describe, expect, it, vi } from "vitest";

// The fixture connector records the production pinned lookup result, then
// remaps only the final test socket to our synthetic loopback HTTP server.
// This performs real Node fetch/Undici dispatch and streaming lifecycle work
// without making public network requests or permitting private app URLs.
const fixture = vi.hoisted(() => ({ port: 0, resolved: [] as string[], closeFinished: false, agents: [] as { destroy(): Promise<void> }[] }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return { ...actual, Agent: class extends actual.Agent {
    constructor(options: import("undici").Agent.Options) {
      const connect = options.connect;
      if (!connect || typeof connect === "function" || !("lookup" in connect) || !connect.lookup) throw new Error("Missing pinned lookup");
      const pinned = connect.lookup;
      const lookup: LookupFunction = (hostname, opts, callback) => {
        pinned(hostname, { ...opts, all: false }, (error, address) => {
          if (error) { callback(error, "", 0); return; }
          if (typeof address !== "string") throw new Error("Expected single pinned address");
          fixture.resolved.push(address);
          if (opts.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
          else callback(null, "127.0.0.1", 4);
        });
      };
      const connector = actual.buildConnector({ ...connect, lookup });
      super({ ...options, connect: (opts, callback) => connector({ ...opts, port: String(fixture.port) }, callback) });
      fixture.agents.push(this);
    }
    override async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => super.close((error?: Error) => error ? reject(error) : resolve()));
      fixture.closeFinished = true;
    }
  } };
});

import { safeFetch } from "./ssrf";
import { lookup } from "node:dns/promises";

describe("safeFetch real local transport fixture", () => {
  it("uses pinned DNS once, keeps Host, and closes only after a streaming response completes", async () => {
    let host = "";
    let finishBody: (() => void) | undefined;
    const server = createServer((req, res) => {
      host = req.headers.host ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("first ");
      finishBody = () => res.end("second");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    fixture.port = address.port;
    try {
      const response = await safeFetch("http://jobs.example/stream", {});
      expect(host).toBe("jobs.example");
      expect(fixture.resolved).toEqual(["93.184.216.34"]);
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(fixture.closeFinished).toBe(false);
      finishBody?.();
      expect(await response.text()).toBe("first second");
      await vi.waitFor(() => expect(fixture.closeFinished).toBe(true), { timeout: 6_000 });
    } finally {
      finishBody?.();
      await Promise.all(fixture.agents.map((agent) => agent.destroy()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);
});
