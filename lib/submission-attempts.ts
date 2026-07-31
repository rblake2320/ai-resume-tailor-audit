import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";
import { withFileLock } from "./file-lock.ts";
import { verifySubmissionApproval, type ApprovalReceipt, type SubmissionPreview } from "./submission-connectors.ts";

export const PRIOR_ATTEMPT_STATEMENT = "I understand this exact packet may already have reached the provider and authorize one retry." as const;

export type SubmissionAttemptIdentity = Pick<SubmissionPreview, "provider" | "applicationId" | "packetChecksum">;
export type SubmissionAttemptRecord = SubmissionAttemptIdentity & {
  version: 1; key: string; attemptId: string; status: "pending" | "uncertain" | "accepted";
  startedAt: string; updatedAt: string; priorAttemptId?: string;
};

export interface AttemptDurability {
  commit(recordPath: string, value: SubmissionAttemptRecord): Promise<void>;
}

const attemptKey = (identity: SubmissionAttemptIdentity) => createHash("sha256").update(canonicalJson(identity)).digest("hex");

const SubmissionAttemptRecordSchema = z.strictObject({
  version: z.literal(1), key: z.string().regex(/^[a-f0-9]{64}$/u),
  provider: z.enum(["greenhouse", "lever", "gmail"]), applicationId: z.string().min(1),
  packetChecksum: z.string().regex(/^[a-f0-9]{64}$/u), attemptId: z.string().uuid(),
  status: z.enum(["pending", "uncertain", "accepted"]), startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(), priorAttemptId: z.string().uuid().optional(),
}).superRefine((record, context) => {
  if (record.key !== attemptKey({ provider: record.provider, applicationId: record.applicationId, packetChecksum: record.packetChecksum })) {
    context.addIssue({ code: "custom", path: ["key"], message: "Attempt key does not match its identity." });
  }
});

function configuredDirectory() {
  const value = process.env.RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR?.trim();
  if (!value) throw new Error("RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR must be configured.");
  if (!path.isAbsolute(value)) throw new Error("RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR must be an absolute path on durable storage.");
  return value;
}

function pathsFor(identity: SubmissionAttemptIdentity, directory = configuredDirectory()) {
  const key = attemptKey(identity);
  return { key, record: path.join(directory, `${key}.json`), lock: path.join(directory, `${key}.lock`), directory };
}

async function readRecord(recordPath: string): Promise<SubmissionAttemptRecord | undefined> {
  try { return SubmissionAttemptRecordSchema.parse(JSON.parse(await readFile(recordPath, "utf8"))) as SubmissionAttemptRecord; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

const unsupportedWindowsDirectorySync = new Set(["EINVAL", "ENOTSUP", "EISDIR", "EPERM"]);
type DirectorySyncHandle = Pick<FileHandle, "sync" | "close">;
type DirectoryOpener = (directoryPath: string) => Promise<DirectorySyncHandle>;

async function syncContainingDirectory(recordPath: string, platform: NodeJS.Platform, directoryOpener: DirectoryOpener) {
  let directory: DirectorySyncHandle | undefined;
  try {
    directory = await directoryOpener(path.dirname(recordPath));
    await directory.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    // Node/Windows does not consistently permit directory handles or directory
    // FlushFileBuffers. The renamed file itself was already reopened r+ and
    // flushed above, so only these verified Windows API limitations use that
    // fallback. POSIX must fsync the containing directory and fails closed on
    // every error; otherwise rename metadata could disappear after power loss.
    if (platform !== "win32" || !unsupportedWindowsDirectorySync.has(code)) throw error;
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

export function createDurableAttemptWriter(options: {
  platform?: NodeJS.Platform;
  directoryOpener?: DirectoryOpener;
} = {}): AttemptDurability {
  const platform = options.platform ?? process.platform;
  const directoryOpener = options.directoryOpener ?? (async (directoryPath) => open(directoryPath, "r"));
  return {
  async commit(recordPath, value) {
    const temporary = `${recordPath}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryHandle: FileHandle | undefined;
    try {
      temporaryHandle = await open(temporary, "wx", 0o600);
      await temporaryHandle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = undefined;
      await rename(temporary, recordPath);

      // Flush the renamed file itself on every platform. POSIX additionally
      // needs the directory entry flushed; some Windows/filesystem APIs do not
      // permit opening directories, so only the documented unsupported errors
      // are tolerated there.
      const finalHandle = await open(recordPath, "r+");
      try { await finalHandle.sync(); } finally { await finalHandle.close(); }
      await syncContainingDirectory(recordPath, platform, directoryOpener);
    } catch (error) {
      await temporaryHandle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  };
}

export const durableAttemptWriter: AttemptDurability = createDurableAttemptWriter();

const identityFor = (preview: SubmissionPreview): SubmissionAttemptIdentity => ({
  provider: preview.provider, applicationId: preview.applicationId, packetChecksum: preview.packetChecksum,
});

/**
 * Records pending before provider I/O. Accepted/pending attempts fail closed.
 * An uncertain result can be retried only by a later signed receipt whose
 * preview acknowledges the exact prior attempt; no unsigned flag is read.
 */
export async function executeSubmissionAttempt<T>(
  input: { receipt: ApprovalReceipt; approvalSecret: string; directory?: string; durability?: AttemptDurability },
  transport: () => Promise<T>,
): Promise<T> {
  const preview = verifySubmissionApproval(input.receipt, input.approvalSecret);
  const identity = identityFor(preview);
  const durability = input.durability ?? durableAttemptWriter;
  const paths = pathsFor(identity, input.directory);
  await mkdir(paths.directory, { recursive: true });

  const active = await withFileLock(paths.lock, async () => {
    const previous = await readRecord(paths.record);
    if (previous?.status === "accepted") throw new Error("This exact application packet was already accepted by the provider.");
    if (previous?.status === "pending") throw new Error("A provider attempt is pending or its process crashed. Stop all submitters and run the documented recovery command before retrying.");
    if (previous?.status === "uncertain") {
      const acknowledgement = preview.priorAttemptAcknowledgement;
      if (!acknowledgement || acknowledgement.attemptId !== previous.attemptId
        || acknowledgement.statement !== PRIOR_ATTEMPT_STATEMENT
        || Date.parse(input.receipt.approvedAt) <= Date.parse(previous.updatedAt)) {
        throw new Error("The previous provider outcome is uncertain. A newly signed preview with the exact prior-attempt acknowledgement is required.");
      }
    }
    const now = new Date().toISOString();
    const next: SubmissionAttemptRecord = {
      version: 1, ...identity, key: paths.key, attemptId: randomUUID(), status: "pending",
      startedAt: now, updatedAt: now, ...(previous ? { priorAttemptId: previous.attemptId } : {}),
    };
    await durability.commit(paths.record, next);
    return next;
  });

  try {
    const result = await transport();
    await withFileLock(paths.lock, async () => {
      const current = await readRecord(paths.record);
      if (!current || current.attemptId !== active.attemptId || current.status !== "pending") throw new Error("Submission attempt state changed unexpectedly; acceptance was not recorded.");
      await durability.commit(paths.record, { ...current, status: "accepted", updatedAt: new Date().toISOString() });
    });
    return result;
  } catch (error) {
    await withFileLock(paths.lock, async () => {
      const current = await readRecord(paths.record);
      if (current?.attemptId === active.attemptId && current.status === "pending") await durability.commit(paths.record, { ...current, status: "uncertain", updatedAt: new Date().toISOString() });
    });
    throw error;
  }
}

export async function readSubmissionAttempt(identity: SubmissionAttemptIdentity, directory?: string) {
  const paths = pathsFor(identity, directory); await mkdir(paths.directory, { recursive: true });
  return withFileLock(paths.lock, () => readRecord(paths.record));
}

/** Operator-only crash recovery. Call only after every submitter is stopped. */
export async function recoverPendingSubmissionAttempt(identity: SubmissionAttemptIdentity, directory?: string, durability: AttemptDurability = durableAttemptWriter) {
  const paths = pathsFor(identity, directory); await mkdir(paths.directory, { recursive: true });
  return withFileLock(paths.lock, async () => {
    const current = await readRecord(paths.record);
    if (!current) throw new Error("Submission attempt was not found.");
    if (current.status !== "pending") throw new Error(`Submission attempt is ${current.status}, not pending.`);
    const recovered = { ...current, status: "uncertain" as const, updatedAt: new Date().toISOString() };
    await durability.commit(paths.record, recovered); return recovered;
  });
}
