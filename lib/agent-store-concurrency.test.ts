import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { executeAgentOperation } from "./agent-service";

const run = promisify(execFile);
const probe = path.join(import.meta.dirname, "testdata", "agent-operation-probe.ts");

let root = "";
let store = "";
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "foundry-race-"));
  store = path.join(root, "store.json");
  process.env.RESUME_FOUNDRY_AGENT_STORE = store;
  process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY = "test-only-audit-key-with-32-bytes-minimum";
  process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = "human-only";
  process.env.RESUME_FOUNDRY_DAILY_APPLICATION_LIMIT = "1";
});
afterEach(async () => {
  delete process.env.RESUME_FOUNDRY_AGENT_STORE;
  delete process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY;
  delete process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET;
  delete process.env.RESUME_FOUNDRY_DAILY_APPLICATION_LIMIT;
  await rm(root, { recursive: true, force: true });
});

/** Runs one operation in its own OS process against the same store. */
async function inChildProcess(request: unknown) {
  const { stdout } = await run(process.execPath, ["--experimental-strip-types", probe, store, JSON.stringify(request)], {
    env: { ...process.env, RESUME_FOUNDRY_AGENT_STORE: store },
    timeout: 60_000,
  });
  return JSON.parse(stdout) as { ok: boolean; error?: string };
}

async function approvedApplications(count: number) {
  const imported = await executeAgentOperation({ operation: "jobs.import", input: { title: "Engineer", company: "Acme", description: "Build reliable TypeScript systems with testing and security." }, actor: "test" });
  const jobId = (imported.result as { id: string }).id;
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const prepared = await executeAgentOperation({ operation: "applications.prepare", input: { jobId, packet: { resume: "synthetic" } }, actor: "test", piiApproved: true });
    const id = (prepared.result as { id: string }).id;
    await executeAgentOperation({ operation: "applications.approve", input: { applicationId: id }, actor: "human", humanApprovalSecret: "human-only" });
    ids.push(id);
  }
  return ids;
}

describe("agent store cross-process safety", () => {
  it("enforces the daily limit across concurrent independent processes", async () => {
    // Regression: with an in-process promise queue only, four separate processes
    // each read the same store, all four were told submission was authorized
    // under a limit of one, and three writes were lost.
    const ids = await approvedApplications(4);
    const results = await Promise.all(ids.map((applicationId) =>
      inChildProcess({ operation: "applications.mark_submitted", input: { applicationId }, actor: "racer", piiApproved: true })));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    for (const denied of results.filter((result) => !result.ok)) {
      expect(denied.error).toMatch(/Daily application limit/);
    }
    const persisted = JSON.parse(await readFile(store, "utf8")) as { applications: { submittedAt: string | null }[] };
    expect(persisted.applications.filter((application) => application.submittedAt)).toHaveLength(1);
  }, 120_000);

  it("loses no audit entry when independent processes write concurrently", async () => {
    // Regression: last-writer-wins on the whole file silently dropped audit
    // rows — 13 expected, 11 or 12 observed.
    const before = (JSON.parse(await readFile(store, "utf8").catch(() => '{"audit":[]}')) as { audit: unknown[] }).audit.length;
    const searches = Array.from({ length: 6 }, (_, index) =>
      inChildProcess({ operation: "jobs.search", input: { query: `q${index}` }, actor: `racer-${index}` }));
    const results = await Promise.all(searches);
    expect(results.every((result) => result.ok)).toBe(true);

    const persisted = JSON.parse(await readFile(store, "utf8")) as { audit: unknown[] };
    expect(persisted.audit.length).toBe(before + 6);
  }, 120_000);
});
