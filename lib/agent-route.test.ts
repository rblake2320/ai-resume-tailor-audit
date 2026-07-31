import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST } from "../app/api/agent/[operation]/route";

let root = "";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "foundry-route-")); process.env.RESUME_FOUNDRY_AGENT_STORE = path.join(root, "store.json"); process.env.RESUME_FOUNDRY_AGENT_API_TOKEN = "api-secret"; });
afterEach(async () => { delete process.env.RESUME_FOUNDRY_AGENT_STORE; delete process.env.RESUME_FOUNDRY_AGENT_API_TOKEN; await rm(root, { recursive: true, force: true }); });
describe("agent HTTP boundary", () => {
  it("rejects unauthenticated calls before operation execution", async () => {
    const response = await POST(new Request("http://localhost/api/agent/jobs.import", { method: "POST", body: "{}" }), { params: Promise.resolve({ operation: "jobs.import" }) });
    expect(response.status).toBe(401);
  });
  it("executes authenticated calls through the shared service", async () => {
    const response = await POST(new Request("http://localhost/api/agent/jobs.import", { method: "POST", headers: { authorization: "Bearer api-secret", "content-type": "application/json" }, body: JSON.stringify({ input: { title: "Engineer", company: "Acme", description: "Build secure and reliable software systems." } }) }), { params: Promise.resolve({ operation: "jobs.import" }) });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, operation: "jobs.import" });
  });
});
