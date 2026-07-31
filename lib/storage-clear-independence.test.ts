import { afterEach, describe, expect, it, vi } from "vitest";
import { CAREER_PATH_RECORDS_KEY } from "./labor-market-storage";

const deleteCareerLedger = vi.hoisted(() => vi.fn());
vi.mock("./career-vault", () => ({ deleteCareerLedger }));

import { clearAllData } from "./storage";

class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length() { return this.#data.size; }
  clear() { this.#data.clear(); }
  getItem(key: string) { return this.#data.get(key) ?? null; }
  key(index: number) { return [...this.#data.keys()][index] ?? null; }
  removeItem(key: string) { this.#data.delete(key); }
  setItem(key: string, value: string) { this.#data.set(key, value); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("full-data deletion independence", () => {
  it("clears career-path records even when encrypted-ledger deletion fails", async () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem(CAREER_PATH_RECORDS_KEY, "private path data");
    vi.stubGlobal("window", { localStorage, dispatchEvent: vi.fn() });
    deleteCareerLedger.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    await expect(clearAllData()).rejects.toThrow(/IndexedDB unavailable/);
    expect(localStorage.getItem(CAREER_PATH_RECORDS_KEY)).toBeNull();
  });
});
