import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeAgentOperation, queryAuditLog } from "./agent-service";

let root = "";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "foundry-agent-")); process.env.RESUME_FOUNDRY_AGENT_STORE = path.join(root, "store.json"); process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = "human-only"; process.env.RESUME_FOUNDRY_DAILY_APPLICATION_LIMIT = "1"; });
afterEach(async () => { delete process.env.RESUME_FOUNDRY_AGENT_STORE; delete process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET; delete process.env.RESUME_FOUNDRY_DAILY_APPLICATION_LIMIT; await rm(root, { recursive: true, force: true }); });

async function prepare() {
  const imported = await executeAgentOperation({ operation: "jobs.import", input: { title: "Engineer", company: "Acme", description: "Build reliable TypeScript systems with testing and security." }, actor: "test" });
  const jobId = (imported.result as { id: string }).id;
  const prepared = await executeAgentOperation({ operation: "applications.prepare", input: { jobId, packet: { resume: "private" } }, actor: "test" });
  return (prepared.result as { id: string }).id;
}

describe("agent policy service", () => {
  it("persists every allowed and denied action in a queryable audit log", async () => {
    await executeAgentOperation({ operation: "jobs.search", input: { query: "engineer" }, actor: "agent" });
    await executeAgentOperation({ operation: "applications.approve", input: { applicationId: "missing" }, actor: "agent" });
    const audit = await queryAuditLog(); expect(audit).toHaveLength(2); expect(audit.map((entry) => entry.allowed)).toEqual([true, false]); expect(JSON.stringify(audit)).not.toContain("human-only");
    expect(JSON.parse(await readFile(process.env.RESUME_FOUNDRY_AGENT_STORE!, "utf8")).audit).toHaveLength(2);
  });
  it("requires human approval and PII approval before handoff or submission", async () => {
    const id = await prepare();
    expect((await executeAgentOperation({ operation: "applications.approve", input: { applicationId: id }, actor: "agent" })).ok).toBe(false);
    expect((await executeAgentOperation({ operation: "applications.approve", input: { applicationId: id }, actor: "human", humanApprovalSecret: "human-only" })).ok).toBe(true);
    expect((await executeAgentOperation({ operation: "applications.open_handoff", input: { applicationId: id }, actor: "agent" })).ok).toBe(false);
    expect((await executeAgentOperation({ operation: "applications.open_handoff", input: { applicationId: id }, actor: "agent", piiApproved: true })).ok).toBe(true);
  });
  it("enforces the configured daily application limit", async () => {
    const first = await prepare(); await executeAgentOperation({ operation: "applications.approve", input: { applicationId: first }, actor: "human", humanApprovalSecret: "human-only" });
    expect((await executeAgentOperation({ operation: "applications.mark_submitted", input: { applicationId: first }, actor: "human", piiApproved: true })).ok).toBe(true);
    const second = await prepare(); await executeAgentOperation({ operation: "applications.approve", input: { applicationId: second }, actor: "human", humanApprovalSecret: "human-only" });
    expect((await executeAgentOperation({ operation: "applications.mark_submitted", input: { applicationId: second }, actor: "human", piiApproved: true })).error).toMatch(/Daily application limit/);
  });
});
