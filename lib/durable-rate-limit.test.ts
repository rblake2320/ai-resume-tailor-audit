import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { configuredPublicRateLimiter, createDurableFixedWindowLimiter } from "./durable-rate-limit";

const run = promisify(execFile);
const roots: string[] = [];
async function root() { const value = await mkdtemp(path.join(tmpdir(), "rf-rate-limit-")); roots.push(value); return value; }
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

describe("durable fixed-window rate limit", () => {
  it("admits only configured capacity and returns a stable retry time", async () => {
    const directory = await root();
    const limiter = createDurableFixedWindowLimiter({ directory, scope: "tailor", limit: 2, windowMs: 60_000, now: () => 90_000 });
    expect(limiter.take()).toEqual({ allowed: true, retryAfterSeconds: 0, remaining: 1 });
    expect(limiter.take()).toEqual({ allowed: true, retryAfterSeconds: 0, remaining: 0 });
    expect(limiter.take()).toEqual({ allowed: false, retryAfterSeconds: 30, remaining: 0 });
  });

  it("opens a fresh window without reopening the prior one", async () => {
    const directory = await root(); let timestamp = 59_999;
    const limiter = createDurableFixedWindowLimiter({ directory, scope: "fetch", limit: 1, windowMs: 60_000, now: () => timestamp });
    expect(limiter.take().allowed).toBe(true); expect(limiter.take().allowed).toBe(false);
    timestamp = 60_000;
    expect(limiter.take().allowed).toBe(true); expect(limiter.take().allowed).toBe(false);
  });

  it("allows exactly one winner across real OS processes", async () => {
    const directory = await root();
    const probe = path.resolve("lib/testdata/take-rate-limit-probe.ts");
    const attempts = await Promise.all(Array.from({ length: 8 }, () => run(process.execPath, ["--experimental-strip-types", probe, directory, "anthropic-spend", "1", "60000", "12345"])));
    expect(attempts.map(({ stdout }) => stdout).filter((value) => value === "WON")).toHaveLength(1);
    expect(attempts.map(({ stdout }) => stdout).filter((value) => value === "LOST")).toHaveLength(7);
  });

  it("hashes hostile scopes and keeps markers inside the configured directory", async () => {
    const directory = await root();
    const limiter = createDurableFixedWindowLimiter({ directory, scope: "../../../../outside", limit: 1, windowMs: 60_000, now: () => 1 });
    expect(limiter.take().allowed).toBe(true);
    const [scopeDirectory] = await readdir(directory);
    expect(scopeDirectory).toMatch(/^[a-f0-9]{64}$/u);
    expect(await readdir(path.join(directory, scopeDirectory))).toEqual(["0.0.used"]);
  });

  it("rejects unsafe configuration", () => {
    expect(() => createDurableFixedWindowLimiter({ directory: "relative", scope: "x", limit: 1, windowMs: 60_000 })).toThrow(/absolute/);
    expect(() => createDurableFixedWindowLimiter({ directory: path.resolve("x"), scope: "", limit: 1, windowMs: 60_000 })).toThrow(/scope/);
    expect(() => createDurableFixedWindowLimiter({ directory: path.resolve("x"), scope: "x", limit: 0, windowMs: 60_000 })).toThrow(/capacity/);
    expect(() => createDurableFixedWindowLimiter({ directory: path.resolve("x"), scope: "x", limit: 1, windowMs: 999 })).toThrow(/window/);
  });

  it("fails closed when production has no shared rate-limit directory", () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorDirectory = process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR;
    try {
      Object.assign(process.env, { NODE_ENV: "production" });
      delete process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR;
      expect(() => configuredPublicRateLimiter("tailor", { limit: 1, windowMs: 60_000 })).toThrow(/required for production/);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorDirectory === undefined) delete process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR;
      else process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR = priorDirectory;
    }
  });
});
