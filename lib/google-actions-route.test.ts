import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_SCOPES, sealConnection } from "./google-oauth";
import { POST } from "../app/api/connections/google/actions/route";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn((name: string, value: string) => jar.values.set(name, value)), delete: vi.fn((name: string) => jar.values.delete(name)), get: vi.fn((name: string) => { const value = jar.values.get(name); return value ? { value } : undefined; }) }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
const key = Buffer.alloc(32, 3);
const connection = () => ({ features: ["email_alerts", "email_drafts", "calendar_events"], tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", obtainedAt: Date.now(), expires_in: 3600, scope: Object.values(GOOGLE_SCOPES).join(" "), token_type: "Bearer" } });
const event = { type: "calendar_event", title: "Synthetic interview", description: "", start: "2026-10-02T12:00:00.000Z", end: "2026-10-02T13:00:00.000Z", reminderMinutes: 30 };
let directory: string;
function request(body: unknown, origin = "https://app.test") { return new Request("https://app.test/api/connections/google/actions", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }); }

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "rf-google-route-"));
  vi.stubEnv("RESUME_FOUNDRY_RATE_LIMIT_DIR", path.join(directory, "rate"));
  vi.stubEnv("RESUME_FOUNDRY_NONCE_STORE", path.join(directory, "nonce"));
  vi.stubEnv("RESUME_FOUNDRY_PUBLIC_ORIGIN", "https://app.test");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "synthetic"); vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "synthetic"); vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://app.test/callback"); vi.stubEnv("RESUME_FOUNDRY_CONNECTION_KEY", key.toString("base64url"));
  jar.values.clear(); jar.set.mockClear(); jar.delete.mockClear(); jar.get.mockClear();
  jar.values.set("rf_google_connection", sealConnection(connection(), key));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected provider call."); }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); });

describe("Google action route security", () => {
  it("denies missing/cross origin before touching cookies or transport", async () => {
    for (const origin of ["", "https://other.test"]) expect((await POST(request({ operation: "read_alerts", query: "job" }, origin))).status).toBe(403);
    expect(jar.get).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds request shape and excludes actor-supplied token/attendee fields", async () => {
    expect((await POST(request({ operation: "review", action: { ...event, attendees: [{ email: "other@example.test" }] } }))).status).toBe(400);
    expect((await POST(request({ operation: "read_alerts", query: "job", access_token: "caller-token" }))).status).toBe(400);
    expect((await POST(request({ operation: "read_alerts", query: "x".repeat(9000) }))).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses approval without a reviewed action and fails closed without replay storage", async () => {
    expect((await POST(request({ operation: "approve", approvalId: crypto.randomUUID() }))).status).toBe(409);
    vi.stubEnv("RESUME_FOUNDRY_NONCE_STORE", "");
    expect((await POST(request({ operation: "review", action: event }))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("binds reviewed contents to one connection and one approval, and independently reads back provider outcome", async () => {
    const reviewResponse = await POST(request({ operation: "review", action: event }));
    expect(reviewResponse.status).toBe(200);
    const { review } = await reviewResponse.json();
    const sealedReview = jar.values.get("rf_google_action_review")!;
    let posted: Record<string, unknown> = {};
    const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") { posted = JSON.parse(String(init.body)); return Response.json({ id: posted.id }); }
      return Response.json(posted);
    });
    vi.stubGlobal("fetch", transport);
    const approved = await POST(request({ operation: "approve", approvalId: review.id }));
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ receipt: { verified: true, type: "calendar_event" } });
    expect(transport).toHaveBeenCalledTimes(2);
    jar.values.set("rf_google_action_review", sealedReview);
    expect((await POST(request({ operation: "approve", approvalId: review.id }))).status).toBe(409);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects an approval transplanted to another sealed Google connection", async () => {
    const { review } = await (await POST(request({ operation: "review", action: event }))).json();
    const other = connection(); other.tokens.refresh_token = "different-synthetic-refresh";
    jar.values.set("rf_google_connection", sealConnection(other, key));
    expect((await POST(request({ operation: "approve", approvalId: review.id }))).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns selected alerts without exposing sealed tokens", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [] })));
    const result = await POST(request({ operation: "read_alerts", query: "job" }));
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ alerts: [] });
  });
});
