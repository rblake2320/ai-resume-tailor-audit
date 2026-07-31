import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueSubmissionApproval, outgoingDataCategories, submissionDestination, type SubmissionPreview, type SubmissionTarget } from "./submission-connectors";
import { createDurableAttemptWriter, durableAttemptWriter, executeSubmissionAttempt, PRIOR_ATTEMPT_STATEMENT, readSubmissionAttempt, recoverPendingSubmissionAttempt, type AttemptDurability } from "./submission-attempts";

const run = promisify(execFile);
const secret = "submission-attempt-test-secret-value";
const checksum = "a".repeat(64);
const target: SubmissionTarget = { provider: "lever", site: "test-site", postingId: "posting-1", requiredFields: ["name", "email"] };
const fields = { name: "Ada Lovelace", email: "ada@example.com" };
const basePreview = (): SubmissionPreview => ({
  applicationId: "application-1", provider: "lever", company: "Example", role: "Engineer",
  destination: submissionDestination(target), packetVersion: 1, resumeChecksum: "b".repeat(64),
  coverLetterChecksum: "c".repeat(64), packetChecksum: checksum,
  personalDataCategories: outgoingDataCategories(fields, target), fields,
  createdAt: "2026-07-31T12:00:00.000Z", target,
});
const identity = { provider: "lever" as const, applicationId: "application-1", packetChecksum: checksum };
const approvalNow = (offsetMs = 0) => new Date(Date.now() + offsetMs);

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); vi.restoreAllMocks(); });
const root = async () => { const value = await mkdtemp(path.join(tmpdir(), "rf-submission-attempt-")); roots.push(value); return value; };

describe("durable submission attempt lifecycle", () => {
  it.each(["EINVAL", "ENOTSUP", "EISDIR", "EPERM"])("fails closed on POSIX directory-sync %s before transport", async (code) => {
    const directory = await root();
    const receipt = issueSubmissionApproval(basePreview(), secret, approvalNow());
    const error = Object.assign(new Error(`directory sync ${code}`), { code });
    const durability = createDurableAttemptWriter({ platform: "linux", directoryOpener: vi.fn().mockRejectedValue(error) });
    const transport = vi.fn();
    await expect(executeSubmissionAttempt({ receipt, approvalSecret: secret, directory, durability }, transport))
      .rejects.toThrow(new RegExp(code, "u"));
    expect(transport).not.toHaveBeenCalled();
    expect((await readSubmissionAttempt(identity, directory))?.status).toBe("pending");
  });

  it.each(["EINVAL", "ENOTSUP", "EISDIR", "EPERM"])("uses the flushed-final-file fallback only for Windows directory-sync %s", async (code) => {
    const directory = await root();
    const receipt = issueSubmissionApproval(basePreview(), secret, approvalNow());
    const error = Object.assign(new Error(`Windows directory handle ${code}`), { code });
    const durability = createDurableAttemptWriter({ platform: "win32", directoryOpener: vi.fn().mockRejectedValue(error) });
    const transport = vi.fn().mockResolvedValue({ accepted: true });
    await expect(executeSubmissionAttempt({ receipt, approvalSecret: secret, directory, durability }, transport))
      .resolves.toEqual({ accepted: true });
    expect(transport).toHaveBeenCalledOnce();
    expect((await readSubmissionAttempt(identity, directory))?.status).toBe("accepted");
  });

  it("fails closed on an unrecognized Windows directory-sync failure", async () => {
    const directory = await root();
    const receipt = issueSubmissionApproval(basePreview(), secret, approvalNow());
    const error = Object.assign(new Error("Windows directory sync I/O failure"), { code: "EIO" });
    const durability = createDurableAttemptWriter({ platform: "win32", directoryOpener: vi.fn().mockRejectedValue(error) });
    const transport = vi.fn();
    await expect(executeSubmissionAttempt({ receipt, approvalSecret: secret, directory, durability }, transport))
      .rejects.toThrow(/I\/O failure/u);
    expect(transport).not.toHaveBeenCalled();
  });

  it("never reaches transport until the pending record's durable commit succeeds", async () => {
    const directory = await root();
    const receipt = issueSubmissionApproval(basePreview(), secret, approvalNow());
    const transport = vi.fn();
    const unavailable: AttemptDurability = { commit: vi.fn().mockRejectedValue(new Error("fsync failed")) };
    await expect(executeSubmissionAttempt({ receipt, approvalSecret: secret, directory, durability: unavailable }, transport))
      .rejects.toThrow(/fsync failed/);
    expect(transport).not.toHaveBeenCalled();
    expect(await readSubmissionAttempt(identity, directory)).toBeUndefined();
  });

  it("orders durable pending commit before I/O and durably records an uncertain result", async () => {
    const directory = await root();
    const receipt = issueSubmissionApproval(basePreview(), secret, approvalNow());
    const events: string[] = [];
    const observing: AttemptDurability = {
      async commit(recordPath, value) {
        events.push(`commit:${value.status}`);
        await durableAttemptWriter.commit(recordPath, value);
      },
    };
    await expect(executeSubmissionAttempt({ receipt, approvalSecret: secret, directory, durability: observing }, async () => {
      events.push("transport");
      throw new Error("connection lost after write");
    })).rejects.toThrow(/connection lost/);
    expect(events).toEqual(["commit:pending", "transport", "commit:uncertain"]);
    expect((await readSubmissionAttempt(identity, directory))?.status).toBe("uncertain");
  });

  it("records before I/O, blocks an unsigned retry, and requires a new signed exact acknowledgement", async () => {
    const directory = await root();
    const first = issueSubmissionApproval(basePreview(), secret, approvalNow());
    const failing = vi.fn().mockRejectedValue(new Error("socket closed after write"));
    await expect(executeSubmissionAttempt({ receipt: first, approvalSecret: secret, directory }, failing)).rejects.toThrow(/socket closed/);
    const uncertain = await readSubmissionAttempt(identity, directory);
    expect(uncertain).toMatchObject({ status: "uncertain", provider: "lever", applicationId: "application-1", packetChecksum: checksum });

    // An unsigned/request-level flag has nowhere to enter this API. Reusing a
    // signed preview without the acknowledgement remains blocked.
    const plainRetry = issueSubmissionApproval(basePreview(), secret, approvalNow(1_000));
    await expect(executeSubmissionAttempt({ receipt: plainRetry, approvalSecret: secret, directory }, vi.fn()))
      .rejects.toThrow(/newly signed preview/);

    const acknowledged = issueSubmissionApproval({
      ...basePreview(), priorAttemptAcknowledgement: { attemptId: uncertain!.attemptId, statement: PRIOR_ATTEMPT_STATEMENT },
    }, secret, approvalNow(1_000));
    const transport = vi.fn().mockResolvedValue({ accepted: true });
    await expect(executeSubmissionAttempt({ receipt: acknowledged, approvalSecret: secret, directory }, transport)).resolves.toEqual({ accepted: true });
    expect(transport).toHaveBeenCalledOnce();
    await expect(executeSubmissionAttempt({ receipt: acknowledged, approvalSecret: secret, directory }, vi.fn()))
      .rejects.toThrow(/already accepted/);
  });

  it("allows exactly one transport across real contending processes", async () => {
    const directory = await root();
    const receiptPath = path.join(directory, "receipt.json");
    const transportLog = path.join(directory, "transport.log");
    await writeFile(receiptPath, JSON.stringify(issueSubmissionApproval(basePreview(), secret, approvalNow())));
    const probe = path.join(import.meta.dirname, "testdata", "submission-attempt-probe.ts");
    const results = await Promise.all(Array.from({ length: 8 }, () => run(process.execPath, ["--experimental-strip-types", probe, directory, receiptPath, transportLog, secret])));
    expect(results.filter(({ stdout }) => stdout === "TRANSPORTED")).toHaveLength(1);
    expect((await readFile(transportLog, "utf8")).trim().split(/\r?\n/u)).toHaveLength(1);
  });

  it("never ages out pending state and requires explicit operator recovery", async () => {
    const directory = await root();
    const receipt = issueSubmissionApproval(basePreview(), secret, approvalNow());
    const receiptPath = path.join(directory, "crash-receipt.json");
    const transportLog = path.join(directory, "crash-transport.log");
    await writeFile(receiptPath, JSON.stringify(receipt));
    const probe = path.join(import.meta.dirname, "testdata", "submission-attempt-probe.ts");
    await expect(run(process.execPath, ["--experimental-strip-types", probe, directory, receiptPath, transportLog, secret, "crash"]))
      .rejects.toMatchObject({ code: 17 });
    const pending = await readSubmissionAttempt(identity, directory);
    expect(pending?.status).toBe("pending");
    await expect(executeSubmissionAttempt({ receipt, approvalSecret: secret, directory }, vi.fn())).rejects.toThrow(/pending or its process crashed/);
    expect((await recoverPendingSubmissionAttempt(identity, directory)).status).toBe("uncertain");
  });

  it("fails closed on corrupt or identity-substituted durable state", async () => {
    const directory = await root();
    const receipt = issueSubmissionApproval(basePreview(), secret, approvalNow());
    await expect(executeSubmissionAttempt({ receipt, approvalSecret: secret, directory }, async () => { throw new Error("uncertain"); }))
      .rejects.toThrow(/uncertain/);
    const [recordName] = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    const recordPath = path.join(directory, recordName!);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
    await writeFile(recordPath, JSON.stringify({ ...record, applicationId: "substituted" }));
    const transport = vi.fn();
    await expect(executeSubmissionAttempt({ receipt, approvalSecret: secret, directory }, transport)).rejects.toThrow(/Attempt key/);
    expect(transport).not.toHaveBeenCalled();
  });
});
