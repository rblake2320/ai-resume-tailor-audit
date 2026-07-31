import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { consumeSubmissionApproval } from "./submission-ledger";

let root = "";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "submission-ledger-")); process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER = path.join(root, "used.jsonl"); });
afterEach(async () => { delete process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER; await rm(root, { recursive: true, force: true }); });

const readLines = async () =>
  (await readFile(process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER!, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

describe("submission approval consumption", () => {
  it("durably rejects approval receipt replay and records the use", async () => {
    const use = { nonce: "nonce-1", applicationId: "app-1", provider: "greenhouse", consumedAt: "2026-01-01T00:00:00Z" };
    await consumeSubmissionApproval(use);
    await expect(consumeSubmissionApproval(use)).rejects.toThrow(/already been consumed/);
    expect(await readLines()).toEqual([use]);
  });

  it("lets exactly one of many concurrent attempts consume a nonce", async () => {
    const use = { nonce: "same", applicationId: "app-1", provider: "lever", consumedAt: "2026-01-01T00:00:00Z" };
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => consumeSubmissionApproval(use)));
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(5);
    expect(await readLines()).toHaveLength(1);
  });

  it("appends rather than rewriting, so concurrent records cannot be lost", async () => {
    // Regression: the ledger read the whole JSON file, pushed, and rewrote it.
    // Under concurrency the last writer won and earlier records vanished.
    // Cross-process atomicity of the claim itself is covered in nonce-store.test.ts.
    await Promise.all(["a", "b", "c", "d", "e"].map((nonce) =>
      consumeSubmissionApproval({ nonce, applicationId: `app-${nonce}`, provider: "greenhouse", consumedAt: "2026-01-01T00:00:00Z" })));
    expect((await readLines()).map((entry) => entry.nonce).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("fails closed when the ledger path is unset or relative", async () => {
    const use = { nonce: "n", applicationId: "app", provider: "gmail", consumedAt: "2026-01-01T00:00:00Z" };
    delete process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER;
    await expect(consumeSubmissionApproval(use)).rejects.toThrow(/must be configured/);
    process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER = "relative/used.jsonl";
    await expect(consumeSubmissionApproval(use)).rejects.toThrow(/absolute path/);
  });
});
