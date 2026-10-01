import { afterEach, describe, expect, it, vi } from "vitest";
import type { LookupFunction } from "node:net";

const state = vi.hoisted(() => ({ agents: [] as { lookup: LookupFunction; close: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]) }));
vi.mock("undici", () => ({ Agent: class {
  constructor(options: { connect: { lookup: LookupFunction } }) {
    state.agents.push({ lookup: options.connect.lookup, close: this.close, destroy: this.destroy });
  }
  close = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
} }));

import { safeFetch } from "./ssrf";
import { lookup } from "node:dns/promises";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); state.agents.length = 0; });

describe("safeFetch DNS pinning", () => {
  it("passes a dispatcher pinned to the validated addresses and preserves the HTTPS hostname", async () => {
    const transport = vi.fn(async () => new Response("fixture"));
    vi.stubGlobal("fetch", transport);
    const response = await safeFetch("https://jobs.example/careers", {});
    expect(await response.text()).toBe("fixture");
    expect(transport.mock.calls[0]).toEqual([new URL("https://jobs.example/careers"), expect.objectContaining({ dispatcher: expect.any(Object), redirect: "manual" })]);
    expect(state.agents).toHaveLength(1);
    const callback = vi.fn();
    state.agents[0].lookup("jobs.example", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(state.agents[0].close).toHaveBeenCalledOnce();
  });

  it("cannot use a dispatcher for a different hostname", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("fixture")));
    await safeFetch("https://jobs.example/", {});
    const callback = vi.fn();
    expect(state.agents).toHaveLength(1);
    state.agents[0].lookup("rebound.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ reason: "dns_hostname_changed" }), "", 0);
  });

  it("revalidates redirects and creates a fresh pinned dispatcher for every hop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example/jobs" } })).mockResolvedValueOnce(new Response("done")));
    expect(await (await safeFetch("https://jobs.example/", {})).text()).toBe("done");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(state.agents).toHaveLength(2);
    expect(state.agents.every((agent) => agent.close.mock.calls.length === 1)).toBe(true);
  });

  it("destroys the dispatcher when fetching fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fixture connection failed")));
    await expect(safeFetch("https://jobs.example/", {})).rejects.toThrow("fixture connection failed");
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].destroy).toHaveBeenCalledOnce();
  });
});
