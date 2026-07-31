import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configuredNonceStore, createDurableNonceStore, createInMemoryNonceStore } from "./nonce-store";

const freshDirectory = () => path.join(mkdtempSync(path.join(tmpdir(), "rf-nonce-")), "store");
const probe = path.join(import.meta.dirname, "testdata", "consume-nonce-probe.ts");

describe("nonce store", () => {
  it("consumes a nonce exactly once in a single process", () => {
    const store = createDurableNonceStore({ directory: freshDirectory() });
    expect(store.consume("nonce-a")).toBe(true);
    expect(store.consume("nonce-a")).toBe(false);
    expect(store.consume("nonce-b")).toBe(true);
  });

  it("consumes a nonce exactly once across concurrent independent processes", () => {
    // Regression for the original defect: the submission ledger serialised
    // writes with a module-scoped promise queue, so two module instances each
    // read consumed:[] and both proceeded to transmit. Reproduced previously as
    // two fulfilled consumes with one lost write.
    const directory = freshDirectory();
    const results = Array.from({ length: 8 }, () =>
      execFileSync(process.execPath, ["--experimental-strip-types", probe, directory, "contended-nonce"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    expect(results.filter((r) => r === "WON")).toHaveLength(1);
    expect(results.filter((r) => r === "LOST")).toHaveLength(7);
  });

  it("derives a safe filename so a hostile nonce cannot traverse paths", () => {
    const directory = freshDirectory();
    const store = createDurableNonceStore({ directory });
    expect(store.consume("../../../../etc/passwd")).toBe(true);
    expect(store.consume("../../../../etc/passwd")).toBe(false);
    const entries = readdirSync(directory);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[a-f0-9]{64}\.used$/u);
  });

  it("treats distinct nonces as distinct even when hostile", () => {
    const store = createDurableNonceStore({ directory: freshDirectory() });
    expect(store.consume("a/../b")).toBe(true);
    expect(store.consume("b")).toBe(true);
  });

  it("rejects a relative directory and a replay-opening ttl", () => {
    expect(() => createDurableNonceStore({ directory: "relative/dir" })).toThrow(/absolute/i);
    expect(() => createDurableNonceStore({ directory: "" })).toThrow(/absolute directory/i);
    expect(() => createDurableNonceStore({ directory: freshDirectory(), ttlMs: 5 })).toThrow(/at least/i);
  });

  it("rejects an empty nonce", () => {
    const store = createDurableNonceStore({ directory: freshDirectory() });
    expect(() => store.consume("")).toThrow(/nonce is required/i);
  });

  it("does not resurrect a nonce whose marker is still inside its ttl", () => {
    const directory = freshDirectory();
    const store = createDurableNonceStore({ directory, ttlMs: 60_000 });
    expect(store.consume("kept")).toBe(true);
    expect(store.consume("kept")).toBe(false);
  });

  it("prunes only markers older than the ttl", () => {
    const directory = freshDirectory();
    const store = createDurableNonceStore({ directory, ttlMs: 60_000 });
    expect(store.consume("stale")).toBe(true);
    const [marker] = readdirSync(directory);
    const longAgo = new Date(Date.now() - 10 * 60_000);
    utimesSync(path.join(directory, marker), longAgo, longAgo);
    // A fresh store instance so the throttle does not suppress the sweep.
    const later = createDurableNonceStore({ directory, ttlMs: 60_000 });
    later.consume("unrelated");
    expect(readdirSync(directory)).not.toContain(marker);
  });

  it("fails closed when the store directory is not configured", () => {
    const previous = process.env.RESUME_FOUNDRY_NONCE_STORE;
    try {
      delete process.env.RESUME_FOUNDRY_NONCE_STORE;
      expect(() => configuredNonceStore()).toThrow(/RESUME_FOUNDRY_NONCE_STORE must be configured/);
      process.env.RESUME_FOUNDRY_NONCE_STORE = "   ";
      expect(() => configuredNonceStore()).toThrow(/RESUME_FOUNDRY_NONCE_STORE must be configured/);
    } finally {
      if (previous === undefined) delete process.env.RESUME_FOUNDRY_NONCE_STORE;
      else process.env.RESUME_FOUNDRY_NONCE_STORE = previous;
    }
  });

  it("keeps the in-memory store single-use for tests", () => {
    const store = createInMemoryNonceStore();
    expect(store.consume("x")).toBe(true);
    expect(store.consume("x")).toBe(false);
  });
});
