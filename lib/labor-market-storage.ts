import { CareerPathRecordSchema, type CareerPathRecord } from "./labor-market";

export const CAREER_PATH_RECORDS_KEY = "rf:career-path-records:v1";
const RECORD_LIMIT = 20;
const RECORD_MAX_BYTES = 128 * 1024;
const STORE_MAX_BYTES = RECORD_LIMIT * RECORD_MAX_BYTES;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function loadCareerPathRecords(): CareerPathRecord[] {
  const storage = browserStorage();
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(CAREER_PATH_RECORDS_KEY); } catch { return []; }
  if (!raw) return [];
  if (byteLength(raw) > STORE_MAX_BYTES) {
    try { storage.setItem(`${CAREER_PATH_RECORDS_KEY}:quarantine`, "Stored career-path data exceeded the supported size limit."); storage.removeItem(CAREER_PATH_RECORDS_KEY); } catch { /* fail-safe read */ }
    return [];
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const result = CareerPathRecordSchema.array().max(RECORD_LIMIT).safeParse(parsed);
  if (result.success) return result.data;
  try {
    storage.setItem(`${CAREER_PATH_RECORDS_KEY}:quarantine`, raw);
    storage.removeItem(CAREER_PATH_RECORDS_KEY);
  } catch { /* reads remain fail-safe if quarantine itself fails */ }
  return [];
}

export function saveCareerPathRecord(record: CareerPathRecord): CareerPathRecord[] {
  const validated = CareerPathRecordSchema.parse(record);
  if (byteLength(JSON.stringify(validated)) > RECORD_MAX_BYTES) throw new Error("Career-path record exceeds the 128 KiB storage limit.");
  const current = loadCareerPathRecords();
  const next = [validated, ...current.filter((item) => item.id !== validated.id)].slice(0, RECORD_LIMIT);
  const storage = browserStorage();
  if (!storage) throw new Error("Browser storage is unavailable; export the record instead.");
  storage.setItem(CAREER_PATH_RECORDS_KEY, JSON.stringify(next));
  return next;
}

export function deleteCareerPathRecord(id: string): CareerPathRecord[] {
  const next = loadCareerPathRecords().filter((item) => item.id !== id);
  const storage = browserStorage();
  if (!storage) throw new Error("Browser storage is unavailable.");
  storage.setItem(CAREER_PATH_RECORDS_KEY, JSON.stringify(next));
  return next;
}

export function clearCareerPathRecords(): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.removeItem(CAREER_PATH_RECORDS_KEY);
  storage.removeItem(`${CAREER_PATH_RECORDS_KEY}:quarantine`);
}
