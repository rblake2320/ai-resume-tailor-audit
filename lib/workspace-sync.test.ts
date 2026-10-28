import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeAgentOperation } from "./agent-service";
import { reviewedWorkspaceSnapshot } from "./workspace-sync";
import { createApplicationPacket, createApplicationRecord } from "./applications";
import { createJobSnapshot } from "./job-inbox";
import type { TailorResult } from "./schema";

const result: TailorResult = { match_score_before: 40, match_score_after: 60, score_rationale: "Fixture", changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [], requirement_evidence: [], ats_checks: [], tailored_resume_markdown: "# Engineer", cover_letter_markdown: "Dear hiring manager." };
let root = "";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "workspace-sync-")); process.env.RESUME_FOUNDRY_AGENT_STORE = path.join(root, "store.json"); process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY = "test-only-workspace-audit-32-bytes-minimum"; process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = "human-test-secret"; });
afterEach(async () => { for (const name of ["RESUME_FOUNDRY_AGENT_STORE", "RESUME_FOUNDRY_AGENT_AUDIT_KEY", "RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET"]) delete process.env[name]; await rm(root, { recursive: true, force: true }); });
async function record() { const jobSnapshot = await createJobSnapshot({ title: "Engineer", company: "Example", description: "Build reliable software systems with testing and careful review, documented releases, incident analysis, and accessible interfaces." }); return createApplicationRecord(await createApplicationPacket({ jobSnapshot, profile: { resume: "Candidate evidence", extraInfo: "" }, result })); }
describe("audited browser/agent snapshot bridge", () => {
  it("round trips reviewed exact packets and refuses stale revisions", async () => {
    const records = [await record()];
    const first = await executeAgentOperation({ operation: "workspace.publish", input: { records, expectedRevision: null }, piiApproved: true, humanApprovalSecret: "human-test-secret" });
    expect(first.ok).toBe(true);
    const read = await executeAgentOperation({ operation: "workspace.read", piiApproved: true });
    expect(read.result).toMatchObject({ records });
    const stale = await executeAgentOperation({ operation: "workspace.publish", input: { records: [], expectedRevision: null }, piiApproved: true, humanApprovalSecret: "human-test-secret" });
    expect(stale.ok).toBe(false); expect(stale.error).toMatch(/changed/);
    expect((await executeAgentOperation({ operation: "workspace.read", piiApproved: true })).result).toMatchObject({ records });
  });
  it("requires disclosure consent on reads and independent human approval on publish", async () => {
    expect((await executeAgentOperation({ operation: "workspace.read" })).ok).toBe(false);
    expect((await executeAgentOperation({ operation: "workspace.publish", input: { records: [], expectedRevision: null }, piiApproved: true })).ok).toBe(false);
  });
  it("rejects packet tampering and duplicate IDs before persistence", async () => {
    const item = await record(); expect(() => reviewedWorkspaceSnapshot([item, item], new Date().toISOString())).toThrow(/Duplicate/);
    item.packet.tailoredResult.tailored_resume_markdown = "Unreviewed replacement";
    expect(() => reviewedWorkspaceSnapshot([item], new Date().toISOString())).toThrow(/integrity/);
  });
});
