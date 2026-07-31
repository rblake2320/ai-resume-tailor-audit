import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { consumeSubmissionApproval } from "./submission-ledger";

let root = "";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "submission-ledger-")); process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER = path.join(root, "used.json"); });
afterEach(async () => { delete process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER; await rm(root, { recursive: true, force: true }); });
describe("submission approval consumption", () => {
  it("durably rejects approval receipt replay", async () => {
    const use = { nonce: "nonce-1", applicationId: "app-1", provider: "greenhouse", consumedAt: "2026-01-01T00:00:00Z" };
    await consumeSubmissionApproval(use);
    await expect(consumeSubmissionApproval(use)).rejects.toThrow(/already been consumed/);
    expect(JSON.parse(await readFile(process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER!, "utf8")).consumed).toEqual([use]);
  });
  it("serializes concurrent attempts so exactly one consumes a nonce", async () => {
    const use = { nonce: "same", applicationId: "app-1", provider: "lever", consumedAt: "2026-01-01T00:00:00Z" };
    const outcomes = await Promise.allSettled([consumeSubmissionApproval(use), consumeSubmissionApproval(use)]);
    expect(outcomes.map((item) => item.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
});
