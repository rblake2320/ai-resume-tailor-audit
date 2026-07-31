import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeAgentOperation, queryAuditLog } from "./agent-service";

let root = "";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "foundry-agent-")); process.env.RESUME_FOUNDRY_AGENT_STORE = path.join(root, "store.json"); process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY = "test-only-audit-key-with-32-bytes-minimum"; process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = "human-only"; process.env.RESUME_FOUNDRY_DAILY_APPLICATION_LIMIT = "1"; });
afterEach(async () => { delete process.env.RESUME_FOUNDRY_AGENT_STORE; delete process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY; delete process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET; delete process.env.RESUME_FOUNDRY_DAILY_APPLICATION_LIMIT; await rm(root, { recursive: true, force: true }); });

async function importJob() {
  const imported = await executeAgentOperation({ operation: "jobs.import", input: { title: "Engineer", company: "Acme", description: "Build reliable TypeScript systems with testing and security." }, actor: "test" });
  return (imported.result as { id: string }).id;
}

async function prepare() {
  const jobId = await importJob();
  const prepared = await executeAgentOperation({ operation: "applications.prepare", input: { jobId, packet: { resume: "Jane Doe, SSN 555-00-1234" } }, actor: "test", piiApproved: true });
  return (prepared.result as { id: string }).id;
}

const approve = (applicationId: string) =>
  executeAgentOperation({ operation: "applications.approve", input: { applicationId }, actor: "human", humanApprovalSecret: "human-only" });

describe("agent policy service", () => {
  it("persists every allowed and denied action in a queryable audit log", async () => {
    await executeAgentOperation({ operation: "jobs.search", input: { query: "engineer" }, actor: "agent" });
    await executeAgentOperation({ operation: "applications.approve", input: { applicationId: "missing" }, actor: "agent" });
    const audit = await queryAuditLog(); expect(audit.entries).toHaveLength(2); expect(audit.entries.map((entry) => entry.allowed)).toEqual([true, false]); expect(JSON.stringify(audit)).not.toContain("human-only");
    expect(JSON.parse(await readFile(process.env.RESUME_FOUNDRY_AGENT_STORE!, "utf8")).audit).toHaveLength(2);
  });

  it("requires PII approval to write or read back a stored packet", async () => {
    // Regression: applications.prepare (which writes the packet server-side) and
    // applications.review (which returns it verbatim) were both ungated, so any
    // bearer holder could store and then read back every résumé and its personal
    // identifiers with no approval of any kind.
    const jobId = await importJob();
    const writeDenied = await executeAgentOperation({ operation: "applications.prepare", input: { jobId, packet: { resume: "Jane Doe, SSN 555-00-1234" } }, actor: "agent" });
    expect(writeDenied.ok).toBe(false);
    expect(writeDenied.error).toMatch(/Protected PII disclosure/);

    const id = await prepare();
    const readDenied = await executeAgentOperation({ operation: "applications.review", input: { applicationId: id }, actor: "agent" });
    expect(readDenied.ok).toBe(false);
    expect(JSON.stringify(readDenied)).not.toContain("555-00-1234");
    expect((await executeAgentOperation({ operation: "applications.review", input: { applicationId: id }, actor: "human", piiApproved: true })).ok).toBe(true);
  });

  it("requires human approval before approval, and PII approval before handoff", async () => {
    const id = await prepare();
    expect((await executeAgentOperation({ operation: "applications.approve", input: { applicationId: id }, actor: "agent" })).ok).toBe(false);
    expect((await approve(id)).ok).toBe(true);
    expect((await executeAgentOperation({ operation: "applications.open_handoff", input: { applicationId: id }, actor: "agent" })).ok).toBe(false);
    expect((await executeAgentOperation({ operation: "applications.open_handoff", input: { applicationId: id }, actor: "agent", piiApproved: true })).ok).toBe(true);
  });

  it("counts an opened handoff against the daily limit", async () => {
    // Regression: the limit guarded only mark_submitted — self-reported
    // bookkeeping — so an agent that simply never called it could open unlimited
    // handoffs, which is the step that actually discloses the packet.
    const first = await prepare(); await approve(first);
    expect((await executeAgentOperation({ operation: "applications.open_handoff", input: { applicationId: first }, actor: "human", piiApproved: true })).ok).toBe(true);
    const second = await prepare(); await approve(second);
    expect((await executeAgentOperation({ operation: "applications.open_handoff", input: { applicationId: second }, actor: "human", piiApproved: true })).error).toMatch(/Daily application limit/);
  });

  it("does not double-charge quota when one application progresses to submission", async () => {
    const id = await prepare(); await approve(id);
    expect((await executeAgentOperation({ operation: "applications.open_handoff", input: { applicationId: id }, actor: "human", piiApproved: true })).ok).toBe(true);
    expect((await executeAgentOperation({ operation: "applications.mark_submitted", input: { applicationId: id }, actor: "human", piiApproved: true })).ok).toBe(true);
  });

  it("enforces the configured daily application limit on submission", async () => {
    const first = await prepare(); await approve(first);
    expect((await executeAgentOperation({ operation: "applications.mark_submitted", input: { applicationId: first }, actor: "human", piiApproved: true })).ok).toBe(true);
    const second = await prepare(); await approve(second);
    expect((await executeAgentOperation({ operation: "applications.mark_submitted", input: { applicationId: second }, actor: "human", piiApproved: true })).error).toMatch(/Daily application limit/);
  });

  it("fails closed when the durable store path is relative", async () => {
    process.env.RESUME_FOUNDRY_AGENT_STORE = "relative/store.json";
    expect((await executeAgentOperation({ operation: "jobs.search", input: {}, actor: "agent" })).ok).toBe(false);
  });
});
