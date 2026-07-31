import { z } from "zod";
import { TailorResultSchema, type TailorResult } from "./schema";
import type { PrivacyMode } from "./pii";
import { JobPostingSnapshotSchema, type JobPostingSnapshot } from "./schema";
import type { ApplicationRecord } from "./applications";
import { deleteCareerLedger } from "./career-vault";
import { clearCareerPathRecords } from "./labor-market-storage";

/**
 * Local-first persistence. The profile and history live only in this
 * browser's localStorage — nothing is stored server-side.
 */

export interface Profile {
  /** User-supplied identity used for exact, local PII masking; never inferred. */
  candidateName?: string;
  resume: string;
  /** Anything that doesn't fit the resume: side projects, metrics, preferences. */
  extraInfo: string;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  jobTitle: string;
  company: string;
  result: TailorResult;
}

const PROFILE_KEY = "art:profile";
const HISTORY_KEY = "art:history";
const HISTORY_LIMIT = 25;

export class LocalPersistenceError extends Error {
  constructor(operation: string, options?: ErrorOptions) {
    super(`Browser storage failed while ${operation}. Your latest changes may not survive a reload.`, options);
    this.name = "LocalPersistenceError";
  }
}

function availableStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage ?? null; }
  catch { return null; }
}

function requireStorage(operation: string): Storage {
  const storage = availableStorage();
  if (!storage) throw new LocalPersistenceError(operation);
  return storage;
}

function writeStored(key: string, value: unknown, operation: string): void {
  try { requireStorage(operation).setItem(key, JSON.stringify(value)); }
  catch (error) {
    if (error instanceof LocalPersistenceError) throw error;
    throw new LocalPersistenceError(operation, { cause: error });
  }
}
const ProfileSchema = z.strictObject({ candidateName: z.string().max(120).optional().default(""), resume: z.string(), extraInfo: z.string(), updatedAt: z.number().finite() });
const HistoryEntrySchema = z.strictObject({ id: z.string().min(1), createdAt: z.number().finite(), jobTitle: z.string(), company: z.string(), result: TailorResultSchema });
const SessionSchema = z.strictObject({ jobText: z.string(), jobUrl: z.string(), jobTitle: z.string(), company: z.string(), emphasis: z.enum(["balanced", "technical", "leadership"]), privacyMode: z.enum(["protect", "review", "exact"]), result: TailorResultSchema.nullable() }).partial();
const SavePointSchema = z.strictObject({
  id: z.string().min(1), createdAt: z.number().finite(), label: z.string(),
  profile: z.strictObject({ candidateName: z.string().max(120).optional().default(""), resume: z.string(), extraInfo: z.string() }),
  session: SessionSchema.required(),
});
const ApplicationPacketSchema = z.strictObject({
  id: z.string().min(1), version: z.number().int().positive(), jobSnapshot: JobPostingSnapshotSchema,
  profileSnapshot: z.strictObject({ resume: z.string(), extraInfo: z.string(), checksum: z.string().min(1) }),
  tailoredResult: TailorResultSchema, screeningAnswers: z.record(z.string(), z.string()), userEdits: z.array(z.string()),
  submissionChannel: z.enum(["guided", "email", "lever", "greenhouse", "other"]).nullable(),
  checksums: z.strictObject({ job: z.string().min(1), profile: z.string().min(1), resume: z.string().min(1), coverLetter: z.string().min(1), packet: z.string().min(1) }),
  createdAt: z.iso.datetime(), submittedAt: z.iso.datetime().nullable(),
});
const ApplicationRecordSchema: z.ZodType<ApplicationRecord> = z.strictObject({
  id: z.string().min(1), packet: ApplicationPacketSchema, packetHistory: z.array(ApplicationPacketSchema).default([]),
  state: z.enum(["discovered", "saved", "reviewing", "tailoring", "ready", "submitted", "recruiter_response", "interviewing", "offer", "rejected", "withdrawn", "no_response"]),
  timeline: z.array(z.strictObject({ at: z.string(), type: z.string(), detail: z.string() })), notes: z.array(z.string()),
  contacts: z.array(z.strictObject({ name: z.string(), role: z.string(), email: z.string() })), interviewDates: z.array(z.string()),
  followUpAt: z.string().nullable(), compensation: z.string(), referral: z.string(), rejectionReason: z.string(), nextAction: z.string(),
  documentLinks: z.array(z.string()), emailLinks: z.array(z.string()), calendarLinks: z.array(z.string()),
  reminders: z.array(z.strictObject({ id: z.string().min(1), kind: z.enum(["follow_up", "interview_prep"]), dueAt: z.string(), status: z.enum(["suggested", "scheduled", "completed", "dismissed"]), createdAt: z.string(), approvedAt: z.string().nullable(), note: z.string() })).default([]),
});

function parseStored<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  const storage = availableStorage(); if (!storage) return fallback;
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return fallback; }
  if (!raw) return fallback;
  try { return schema.parse(JSON.parse(raw)); }
  catch {
    // Quarantine the exact bytes for explicit recovery/export while ensuring one
    // malformed record cannot brick every reload.
    try { storage.setItem(`${key}:quarantine`, raw); storage.removeItem(key); } catch { /* read remains fail-safe even if quarantine cannot be written */ }
    return fallback;
  }
}

export function loadProfile(): Profile | null {
  return parseStored(PROFILE_KEY, ProfileSchema.nullable(), null);
}

export function saveProfile(profile: Omit<Profile, "updatedAt">): void {
  if (typeof window === "undefined") return;
  writeStored(PROFILE_KEY, { ...profile, updatedAt: Date.now() }, "saving the profile");
}

export function loadHistory(): HistoryEntry[] {
  return parseStored(HISTORY_KEY, HistoryEntrySchema.array(), []);
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "createdAt">): HistoryEntry[] {
  const next = [
    { ...entry, id: crypto.randomUUID(), createdAt: Date.now() },
    ...loadHistory(),
  ].slice(0, HISTORY_LIMIT);
  if (typeof window !== "undefined") writeStored(HISTORY_KEY, next, "saving generated history");
  return next;
}

export function deleteHistory(id: string): HistoryEntry[] {
  const next = loadHistory().filter((h) => h.id !== id);
  if (typeof window !== "undefined") writeStored(HISTORY_KEY, next, "deleting generated history");
  return next;
}

// ---- Active session (job form + last generated result) -------------------
// So a reload restores the in-progress job and the currently-viewed result,
// not just the saved-run history.
export interface Session {
  jobText: string;
  jobUrl: string;
  jobTitle: string;
  company: string;
  emphasis: "balanced" | "technical" | "leadership";
  privacyMode: PrivacyMode;
  result: TailorResult | null;
}

export interface SavePoint {
  id: string;
  createdAt: number;
  label: string;
  profile: Pick<Profile, "resume" | "extraInfo"> & Pick<Profile, "candidateName">;
  session: Session;
}

const SESSION_KEY = "art:session";
const SAVE_POINTS_KEY = "art:save-points";
const SAVE_POINTS_LIMIT = 12;
const JOB_INBOX_KEY = "art:job-inbox:v1";
const APPLICATIONS_KEY = "art:applications:v1";
const CAREER_BACKUP_MARKER_KEY = "rf:career-last-backup";

export function loadCareerBackupMarker(): string | null {
  const storage = availableStorage(); if (!storage) return null;
  try { return storage.getItem(CAREER_BACKUP_MARKER_KEY); } catch { return null; }
}

export function saveCareerBackupMarker(at: string): void {
  if (typeof window === "undefined") return;
  try { requireStorage("recording the career-ledger backup date").setItem(CAREER_BACKUP_MARKER_KEY, at); }
  catch (error) {
    if (error instanceof LocalPersistenceError) throw error;
    throw new LocalPersistenceError("recording the career-ledger backup date", { cause: error });
  }
}

export function loadSession(): Partial<Session> | null {
  return parseStored(SESSION_KEY, SessionSchema.nullable(), null);
}

export function saveSession(session: Session): void {
  if (typeof window === "undefined") return;
  writeStored(SESSION_KEY, session, "saving the active session");
}

export function loadSavePoints(): SavePoint[] {
  return parseStored(SAVE_POINTS_KEY, SavePointSchema.array(), []);
}

export function addSavePoint(
  profile: Pick<Profile, "resume" | "extraInfo"> & Pick<Profile, "candidateName">,
  session: Session,
  label = "Automatic checkpoint",
): SavePoint[] {
  const current = loadSavePoints();
  const normalizedProfile = { candidateName: profile.candidateName ?? "", resume: profile.resume, extraInfo: profile.extraInfo };
  const comparable = JSON.stringify({ profile: normalizedProfile, session });
  const latest = current[0];
  if (latest && JSON.stringify({ profile: latest.profile, session: latest.session }) === comparable) {
    return current;
  }
  const next = [
    { id: crypto.randomUUID(), createdAt: Date.now(), label, profile: normalizedProfile, session },
    ...current,
  ].slice(0, SAVE_POINTS_LIMIT);
  if (typeof window !== "undefined") writeStored(SAVE_POINTS_KEY, next, "saving a recovery checkpoint");
  return next;
}

export function deleteSavePoint(id: string): SavePoint[] {
  const next = loadSavePoints().filter((point) => point.id !== id);
  if (typeof window !== "undefined") writeStored(SAVE_POINTS_KEY, next, "deleting a recovery checkpoint");
  return next;
}

export function loadJobInbox(): JobPostingSnapshot[] {
  return parseStored(JOB_INBOX_KEY, JobPostingSnapshotSchema.array(), []);
}

/** Snapshots are append-only: callers can add a revision, never mutate one in place. */
export function saveJobInbox(jobs: readonly JobPostingSnapshot[]): void {
  if (typeof window === "undefined") return;
  JobPostingSnapshotSchema.array().parse(jobs);
  writeStored(JOB_INBOX_KEY, jobs, "saving the job inbox");
}

export function deleteJobSnapshot(id: string): JobPostingSnapshot[] {
  const next = loadJobInbox().filter((job) => job.id !== id);
  saveJobInbox(next);
  return next;
}

export function loadApplications(): ApplicationRecord[] {
  return parseStored(APPLICATIONS_KEY, ApplicationRecordSchema.array(), []);
}

export function saveApplications(records: readonly ApplicationRecord[]): void {
  if (typeof window === "undefined") return;
  writeStored(APPLICATIONS_KEY, ApplicationRecordSchema.array().parse(records), "saving application records");
}

export async function clearAllData(): Promise<void> {
  if (typeof window === "undefined") return;
  const failures: unknown[] = [];
  try {
    const storage = requireStorage("erasing local data");
    storage.removeItem(PROFILE_KEY); storage.removeItem(HISTORY_KEY); storage.removeItem(SESSION_KEY);
    storage.removeItem(SAVE_POINTS_KEY); storage.removeItem(JOB_INBOX_KEY); storage.removeItem(APPLICATIONS_KEY);
    storage.removeItem(CAREER_BACKUP_MARKER_KEY);
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index); if (key?.endsWith(":quarantine")) storage.removeItem(key);
    }
  } catch (error) { failures.push(new LocalPersistenceError("erasing local data", { cause: error })); }
  try { clearCareerPathRecords(); } catch (error) { failures.push(error); }
  try { await deleteCareerLedger(); }
  catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    failures.push(new LocalPersistenceError(`erasing the encrypted career ledger${detail}`, { cause: error }));
  }
  try { window.dispatchEvent?.(new Event("resume-foundry:data-cleared")); } catch (error) { failures.push(error); }
  if (failures.length) throw failures[0];
}
