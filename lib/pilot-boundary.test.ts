import { describe, expect, it } from "vitest";
import { pilotBoundary } from "./pilot-boundary";

describe("tester origin admission", () => {
  const secret = "a".repeat(43);
  const env = { RESUME_FOUNDRY_PILOT_MODE: "true", RESUME_FOUNDRY_PILOT_ORIGIN_SECRET: secret };
  const request = (path = "/", headers: HeadersInit = {}, method = "GET") => new Request(`http://localhost:3102${path}`, { method, headers });
  it("preserves the private workshop when pilot mode is disabled", () => expect(pilotBoundary(request(), {})).toBeNull());
  it("fails closed without an origin secret and rejects bypass on pages, assets and APIs", () => {
    expect(pilotBoundary(request(), { RESUME_FOUNDRY_PILOT_MODE: "true" })?.status).toBe(503);
    for (const path of ["/", "/_next/static/app.js", "/api/capabilities", "/api/tailor", "/about"]) {
      expect(pilotBoundary(request(path), env)?.status).toBe(401);
      expect(pilotBoundary(request(path, { "x-resume-pilot-origin": "b".repeat(43) }), env)?.status).toBe(401);
    }
  });
  it("independently refuses shared privileged operations even for the gateway", () => {
    for (const path of ["/api/agent/workspace.read", "/api/submissions/execute", "/api/connections/google/actions", "/api/unexpected"]) {
      expect(pilotBoundary(request(path, { "x-resume-pilot-origin": secret }, "POST"), env)?.status).toBe(403);
    }
  });
  it("requires explicit AI enablement but admits authenticated bounded read operations", () => {
    const headers = { "x-resume-pilot-origin": secret };
    expect(pilotBoundary(request("/api/tailor", headers, "POST"), env)?.status).toBe(503);
    expect(pilotBoundary(request("/api/tailor", headers, "POST"), { ...env, RESUME_FOUNDRY_PILOT_AI_ENABLED: "true" })).toBeNull();
    expect(pilotBoundary(request("/api/jobs/import", headers, "POST"), env)).toBeNull();
    expect(pilotBoundary(request("/api/capabilities", headers), env)).toBeNull();
  });
});
