import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSavePoint,
  clearAllData,
  deleteSavePoint,
  loadJobInbox,
  loadHistory,
  loadSavePoints,
  saveJobInbox,
  type Session,
} from "./storage";
import { createJobSnapshot } from "./job-inbox";

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
});
