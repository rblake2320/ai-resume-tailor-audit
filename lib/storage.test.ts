import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSavePoint,
  clearAllData,
  deleteSavePoint,
  loadJobInbox,
  loadHistory,
  loadApplications,
  loadCareerBackupMarker,
  loadProfile,
  loadSavePoints,
  loadSession,
  LocalPersistenceError,
  saveApplications,
  saveCareerBackupMarker,
  saveJobInbox,
  saveProfile,
  type Session,
} from "./storage";
import { createJobSnapshot } from "./job-inbox";
import { createApplicationPacket, createApplicationRecord } from "./applications";
import type { TailorResult } from "./schema";

class MemoryStorage {
  #values = new Map<string, string>();
  getItem(key: string) { return this.#values.get(key) ?? null; }
  setItem(key: string, value: string) { this.#values.set(key, value); }
  removeItem(key: string) { this.#values.delete(key); }
}

const session: Session = {
  jobText: "A sufficiently detailed synthetic job description for a quality engineer role.",
  jobUrl: "https://example.com/job",
  jobTitle: "Quality Engineer",
  company: "Example",
  emphasis: "balanced",
  privacyMode: "protect",
  result: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("local save points", () => {
  beforeEach(() => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `id-${Math.random()}`) });
  });

  it("creates, restores through loading, and deletes a full checkpoint", () => {
    const points = addSavePoint({ resume: "resume v1", extraInfo: "notes" }, session, "Manual");
    expect(points).toHaveLength(1);
    expect(loadSavePoints()[0]).toMatchObject({ label: "Manual", profile: { resume: "resume v1" }, session });
    expect(deleteSavePoint(points[0].id)).toEqual([]);
  });

  it("deduplicates identical consecutive states", () => {
    addSavePoint({ resume: "same", extraInfo: "" }, session);
    addSavePoint({ resume: "same", extraInfo: "" }, session);
    expect(loadSavePoints()).toHaveLength(1);
  });

  it("keeps only the newest twelve checkpoints", () => {
    for (let index = 0; index < 15; index += 1) {
      addSavePoint({ resume: `resume ${index}`, extraInfo: "" }, session);
    }
    const points = loadSavePoints();
    expect(points).toHaveLength(12);
    expect(points[0].profile.resume).toBe("resume 14");
    expect(points.at(-1)?.profile.resume).toBe("resume 3");
  });

  it("erases checkpoints with the rest of the local user data", async () => {
    addSavePoint({ resume: "private", extraInfo: "" }, session);
    await clearAllData();
    expect(loadSavePoints()).toEqual([]);
  });
  it("quarantines malformed persisted history instead of bricking every reload", () => {
    localStorage.setItem("art:history", JSON.stringify([{ result: { broken: true } }]));
    expect(loadHistory()).toEqual([]);
    expect(localStorage.getItem("art:history")).toBeNull();
    expect(localStorage.getItem("art:history:quarantine")).toContain("broken");
  });

  it.each([
    ["art:profile", () => loadProfile(), null],
    ["art:session", () => loadSession(), null],
    ["art:save-points", () => loadSavePoints(), []],
    ["art:job-inbox:v1", () => loadJobInbox(), []],
    ["art:applications:v1", () => loadApplications(), []],
  ] as const)("quarantines malformed persisted data in %s", (key, load, fallback) => {
    localStorage.setItem(key, JSON.stringify([{ unexpected: "private data" }]));
    expect(load()).toEqual(fallback);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(`${key}:quarantine`)).toContain("private data");
  });
});

describe("job inbox persistence", () => {
  beforeEach(() => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);
  });

  it("round-trips validated immutable snapshots", async () => {
    const snapshot = await createJobSnapshot({
      company: "Acme",
      title: "Engineer",
      description: "Build reliable software systems with testing, observability, security, collaboration, documentation, deployment, and customer-focused engineering practices.",
    });
    saveJobInbox([snapshot]);
    expect(loadJobInbox()).toEqual([snapshot]);
  });

  it("round-trips a schema-valid immutable application record", async () => {
    const job = await createJobSnapshot({
      company: "Acme", title: "Engineer",
      description: "Build reliable software systems with testing, observability, security, collaboration, documentation, deployment, and customer-focused engineering practices.",
    });
    const result: TailorResult = {
      match_score_before: 50, match_score_after: 70, score_rationale: "Evidence improved alignment.", changes: [],
      keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [], requirement_evidence: [], ats_checks: [],
      tailored_resume_markdown: "# Resume", cover_letter_markdown: "Cover",
    };
    const record = createApplicationRecord(await createApplicationPacket({ jobSnapshot: job, profile: { resume: "Original", extraInfo: "Evidence" }, result }));
    saveApplications([record]);
    expect(loadApplications()).toEqual([record]);
  });
});

describe("unavailable browser storage", () => {
  it("fails reads closed when localStorage access throws SecurityError", () => {
    const deniedWindow = {} as Window;
    Object.defineProperty(deniedWindow, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
    vi.stubGlobal("window", deniedWindow);
    expect(() => loadProfile()).not.toThrow();
    expect(loadProfile()).toBeNull();
    expect(loadSession()).toBeNull();
    expect(loadApplications()).toEqual([]);
  });

  it("signals a write failure instead of claiming data was saved", () => {
    const failing = {
      getItem: () => null,
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
      removeItem: vi.fn(),
    };
    vi.stubGlobal("window", { localStorage: failing });
    expect(() => saveProfile({ resume: "private resume", extraInfo: "" })).toThrow(LocalPersistenceError);
    expect(() => addSavePoint({ resume: "private resume", extraInfo: "" }, session)).toThrow(/may not survive a reload/);
    expect(() => saveCareerBackupMarker("2026-07-31T12:00:00.000Z")).toThrow(LocalPersistenceError);
  });

  it("fails the career backup marker read closed when getItem throws", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new DOMException("denied", "SecurityError"); } } });
    expect(loadCareerBackupMarker()).toBeNull();
  });
});
