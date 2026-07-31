import { afterEach, describe, expect, it, vi } from "vitest";
import { createCareerPathRecord, type LaborMarketSnapshot, type OnetOccupationProfile } from "./labor-market";
import { CAREER_PATH_RECORDS_KEY, clearCareerPathRecords, loadCareerPathRecords, saveCareerPathRecord } from "./labor-market-storage";

class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length() { return this.#data.size; }
  clear() { this.#data.clear(); }
  getItem(key: string) { return this.#data.get(key) ?? null; }
  key(index: number) { return [...this.#data.keys()][index] ?? null; }
  removeItem(key: string) { this.#data.delete(key); }
  setItem(key: string, value: string) { this.#data.set(key, value); }
}

const profile: OnetOccupationProfile = { kind: "occupation_profile", occupationCode: "15-1252.00", occupationTitle: "Software Developers", description: "Develop software.", source: "ONET", sourceUrl: "https://www.onetonline.org/link/summary/15-1252.00", asOfDate: "2026-01-15", retrievedAt: "2026-07-31T12:00:00.000Z", uncertainty: "No hiring guarantee.", skills: ["Programming"], knowledge: [], tasks: [], technologies: [] };
const projection: LaborMarketSnapshot = { occupationCode: "15-1252", occupationTitle: "Software Developers", geography: "United States", employmentLevel: 1000, medianWage: 120000, projectedGrowthPercent: 8, annualOpenings: 100, replacementOpenings: 20, projectionStartYear: 2024, projectionEndYear: 2034, asOfDate: "2026-01-01", source: "BLS", sourceUrl: "https://www.bls.gov/emp/", uncertainty: "Projection only.", retrievedAt: "2026-07-31T12:00:00.000Z" };

afterEach(() => vi.unstubAllGlobals());

describe("career-path local records", () => {
  it("round-trips validated provenance and quarantine-recovers malformed state", () => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });
    const record = createCareerPathRecord({ profile, projection, evidenceGaps: [], trainingResources: [], id: "path-1", now: new Date("2026-07-31T12:00:00Z") });
    saveCareerPathRecord(record);
    expect(loadCareerPathRecords()).toEqual([record]);
    localStorage.setItem(CAREER_PATH_RECORDS_KEY, JSON.stringify([{ ...record, projection: { ...projection, sourceUrl: "not-a-url" } }]));
    expect(loadCareerPathRecords()).toEqual([]);
    expect(localStorage.getItem(`${CAREER_PATH_RECORDS_KEY}:quarantine`)).not.toBeNull();
  });

  it("erases both active and quarantined career-path records", () => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });
    localStorage.setItem(CAREER_PATH_RECORDS_KEY, "[]");
    localStorage.setItem(`${CAREER_PATH_RECORDS_KEY}:quarantine`, "bad");
    clearCareerPathRecords();
    expect(localStorage.length).toBe(0);
  });
});
