import type { TailorResult } from "./schema";

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

export function clearAllData(): void {
  if (!canStore()) return;
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(HISTORY_KEY);
}
