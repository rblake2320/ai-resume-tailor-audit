import type { TailorResult } from "./schema";
import type { PrivacyMode } from "./pii";
import { JobPostingSnapshotSchema, type JobPostingSnapshot } from "./schema";
import type { ApplicationRecord } from "./applications";

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

export function loadProfile(): Profile | null {
  if (!canStore()) return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: Omit<Profile, "updatedAt">): void {
  if (!canStore()) return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, updatedAt: Date.now() }));
}

export function loadHistory(): HistoryEntry[] {
  if (!canStore()) return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
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
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Partial<Session>) : null;
  } catch {
    return null;
  }
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
  try {
    const raw = localStorage.getItem(SAVE_POINTS_KEY);
    return raw ? (JSON.parse(raw) as SavePoint[]) : [];
  } catch {
    return [];
  }
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
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(JOB_INBOX_KEY) ?? "[]");
    return JobPostingSnapshotSchema.array().parse(parsed);
  } catch {
    return [];
  }
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
  try { return JSON.parse(localStorage.getItem(APPLICATIONS_KEY) ?? "[]") as ApplicationRecord[]; }
  catch { return []; }
}

export function saveApplications(records: readonly ApplicationRecord[]): void {
  if (!canStore()) return;
  localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(records));
}

export function clearAllData(): void {
  if (!canStore()) return;
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SAVE_POINTS_KEY);
  localStorage.removeItem(JOB_INBOX_KEY);
  localStorage.removeItem(APPLICATIONS_KEY);
  window.dispatchEvent?.(new Event("resume-foundry:data-cleared"));
}
