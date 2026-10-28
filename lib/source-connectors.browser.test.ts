// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobInbox } from "../components/JobInbox";
import { loadJobInbox } from "./storage";

vi.mock("./durable-rate-limit", () => ({ enforcePublicRateLimit: () => null }));
vi.mock("./job-connectors", async (importOriginal) => ({ ...await importOriginal<typeof import("./job-connectors")>(), fetchGreenhousePage: async (_query: string, options: { offset?: number }) => ({ jobs: [{ source: "greenhouse", sourceId: String(options.offset ?? 0), company: "Fixture", title: `Engineering role ${options.offset ?? 0}`, description: "Build reliable accessible applications with testing and documentation. ".repeat(3), applicationUrl: `https://example.test/job/${options.offset ?? 0}` }], total: 2, nextOffset: options.offset ? null : 1 }) }));
import { POST } from "../app/api/jobs/import/route";
let root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("crypto", webcrypto); localStorage.clear(); const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("source UI to strict import route", () => {
  it("sends a valid Greenhouse body and persists visible subsequent pages", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return POST(new NextRequest("http://localhost/api/jobs/import", { ...init, signal: init.signal ?? undefined, method: "POST" })); });
    await act(async () => root.render(createElement(JobInbox, { current: { company: "", title: "", description: "" }, onSelect: vi.fn() })));
    const query = document.querySelector('[aria-label="Greenhouse board token"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(query, "fixture"); query.dispatchEvent(new Event("input", { bubbles: true })); });
    const click = async (text: string) => { const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!; await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true }))); };
    await click("Import source"); expect(bodies[0]).toEqual({ source: "greenhouse", query: "fixture", offset: 0 }); await act(async () => vi.waitFor(() => expect(loadJobInbox()).toHaveLength(1)));
    await click("Import next 20 jobs"); expect(bodies[1]).toEqual({ source: "greenhouse", query: "fixture", offset: 1 }); await act(async () => vi.waitFor(() => expect(loadJobInbox()).toHaveLength(2)));
    expect(document.body.textContent).toContain("Engineering role 1");
  });
});
