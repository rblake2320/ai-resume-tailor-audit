import { z } from "zod";
import { TailorResultSchema, type TailorResult } from "./schema";
import type { PrivacyMode } from "./pii";
import { JobPostingSnapshotSchema, type JobPostingSnapshot } from "./schema";
import type { ApplicationRecord } from "./applications";
import { deleteCareerLedger } from "./career-vault";

/**
 * Local-first persistence. The profile and history live only in this
 * browser's localStorage — nothing is stored server-side.
 */

export interface Profile {
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

const canStore = () => typeof window !== "undefined" && !!window.localStorage;
const ProfileSchema = z.strictObject({ resume: z.string(), extraInfo: z.string(), updatedAt: z.number().finite() });
const HistoryEntrySchema = z.strictObject({ id: z.string().min(1), createdAt: z.number().finite(), jobTitle: z.string(), company: z.string(), result: TailorResultSchema });
const SessionSchema = z.strictObject({ jobText: z.string(), jobUrl: z.string(), jobTitle: z.string(), company: z.string(), emphasis: z.enum(["balanced", "technical", "leadership"]), privacyMode: z.enum(["protect", "review", "exact"]), result: TailorResultSchema.nullable() }).partial();
const SavePointSchema = z.strictObject({
  id: z.string().min(1), createdAt: z.number().finite(), label: z.string(),
  profile: z.strictObject({ resume: z.string(), extraInfo: z.string() }),
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
  if (!canStore()) return fallback;
  const raw = localStorage.getItem(key); if (!raw) return fallback;
  try { return schema.parse(JSON.parse(raw)); }
  catch {
    // Quarantine the exact bytes for explicit recovery/export while ensuring one
    // malformed record cannot brick every reload.
    try { localStorage.setItem(`${key}:quarantine`, raw); localStorage.removeItem(key); } catch { /* storage may be full */ }
    return fallback;
  }
}

export function loadProfile(): Profile | null {
  if (!canStore()) return null;
  return parseStored(PROFILE_KEY, ProfileSchema.nullable(), null);
}

export function saveProfile(profile: Omit<Profile, "updatedAt">): void {
  if (!canStore()) return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, updatedAt: Date.now() }));
}

export function loadHistory(): HistoryEntry[] {
  if (!canStore()) return [];
  return parseStored(HISTORY_KEY, HistoryEntrySchema.array(), []);
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "createdAt">): HistoryEntry[] {
  const next = [
    { ...entry, id: crypto.randomUUID(), createdAt: Date.now() },
    ...loadHistory(),
  ].slice(0, HISTORY_LIMIT);
  if (canStore()) localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function deleteHistory(id: string): HistoryEntry[] {
  const next = loadHistory().filter((h) => h.id !== id);
  if (canStore()) localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
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
  profile: Pick<Profile, "resume" | "extraInfo">;
  session: Session;
}

const SESSION_KEY = "art:session";
const SAVE_POINTS_KEY = "art:save-points";
const SAVE_POINTS_LIMIT = 12;
const JOB_INBOX_KEY = "art:job-inbox:v1";
const APPLICATIONS_KEY = "art:applications:v1";

export function loadSession(): Partial<Session> | null {
  if (!canStore()) return null;
  return parseStored(SESSION_KEY, SessionSchema.nullable(), null);
}

export function saveSession(session: Session): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Quota/serialization failure must not break the app.
  }
}

export function loadSavePoints(): SavePoint[] {
  if (!canStore()) return [];
  return parseStored(SAVE_POINTS_KEY, SavePointSchema.array(), []);
}

export function addSavePoint(
  profile: Pick<Profile, "resume" | "extraInfo">,
  session: Session,
  label = "Automatic checkpoint",
): SavePoint[] {
  const current = loadSavePoints();
  const comparable = JSON.stringify({ profile, session });
  const latest = current[0];
  if (latest && JSON.stringify({ profile: latest.profile, session: latest.session }) === comparable) {
    return current;
  }
  const next = [
    { id: crypto.randomUUID(), createdAt: Date.now(), label, profile, session },
    ...current,
  ].slice(0, SAVE_POINTS_LIMIT);
  if (canStore()) localStorage.setItem(SAVE_POINTS_KEY, JSON.stringify(next));
  return next;
}

export function deleteSavePoint(id: string): SavePoint[] {
  const next = loadSavePoints().filter((point) => point.id !== id);
  if (canStore()) localStorage.setItem(SAVE_POINTS_KEY, JSON.stringify(next));
  return next;
}

export function loadJobInbox(): JobPostingSnapshot[] {
  if (!canStore()) return [];
  return parseStored(JOB_INBOX_KEY, JobPostingSnapshotSchema.array(), []);
}

/** Snapshots are append-only: callers can add a revision, never mutate one in place. */
export function saveJobInbox(jobs: readonly JobPostingSnapshot[]): void {
  if (!canStore()) return;
  JobPostingSnapshotSchema.array().parse(jobs);
  localStorage.setItem(JOB_INBOX_KEY, JSON.stringify(jobs));
}

export function deleteJobSnapshot(id: string): JobPostingSnapshot[] {
  const next = loadJobInbox().filter((job) => job.id !== id);
  saveJobInbox(next);
  return next;
}

export function loadApplications(): ApplicationRecord[] {
  if (!canStore()) return [];
  return parseStored(APPLICATIONS_KEY, ApplicationRecordSchema.array(), []);
}

export function saveApplications(records: readonly ApplicationRecord[]): void {
  if (!canStore()) return;
  localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(ApplicationRecordSchema.array().parse(records)));
}

export async function clearAllData(): Promise<void> {
  if (!canStore()) return;
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SAVE_POINTS_KEY);
  localStorage.removeItem(JOB_INBOX_KEY);
  localStorage.removeItem(APPLICATIONS_KEY);
  localStorage.removeItem("rf:career-last-backup");
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index); if (key?.endsWith(":quarantine")) localStorage.removeItem(key);
  }
  await deleteCareerLedger();
  window.dispatchEvent?.(new Event("resume-foundry:data-cleared"));
}
