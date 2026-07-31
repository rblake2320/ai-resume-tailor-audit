import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredPublicRateLimiter, createDurableFixedWindowLimiter, enforcePublicRateLimit } from "./durable-rate-limit";

const run = promisify(execFile);
const roots: string[] = [];
async function root() { const value = await mkdtemp(path.join(tmpdir(), "rf-rate-limit-")); roots.push(value); return value; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

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
    expect(() => createDurableFixedWindowLimiter({ directory: path.resolve("x"), scope: "x", limit: 101, windowMs: 60_000 })).toThrow(/capacity/);
    expect(() => createDurableFixedWindowLimiter({ directory: path.resolve("x"), scope: "x", limit: 1_000, windowMs: 60_000 })).toThrow(/capacity/);
    expect(() => createDurableFixedWindowLimiter({ directory: path.resolve("x"), scope: "x", limit: 1, windowMs: 86_400_001 })).toThrow(/window/);
  });

  it("fills the maximum supported window with bounded synchronous work", async () => {
    const directory = await root();
    const limiter = createDurableFixedWindowLimiter({ directory, scope: "bounded-max", limit: 100, windowMs: 60_000, now: () => 1_000 });
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) expect(limiter.take().allowed).toBe(true);
    expect(limiter.take().allowed).toBe(false);
    expect(performance.now() - started).toBeLessThan(5_000);
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

  it("returns 429 with Retry-After and fails closed on bad production configuration", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-31T12:00:30Z"));
    const directory = await root();
    const prior = { directory: process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR, limit: process.env.RESUME_FOUNDRY_TAILOR_LIMIT, node: process.env.NODE_ENV };
    try {
      process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR = directory;
      process.env.RESUME_FOUNDRY_TAILOR_LIMIT = "1";
      expect(enforcePublicRateLimit("tailor", { limit: 5, windowMs: 60_000 })).toBeNull();
      const limited = enforcePublicRateLimit("tailor", { limit: 5, windowMs: 60_000 })!;
      expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toMatch(/^\d+$/u);
      expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
      delete process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR;
      Object.assign(process.env, { NODE_ENV: "production" });
      const unavailable = enforcePublicRateLimit("different", { limit: 1, windowMs: 60_000 })!;
      expect(unavailable.status).toBe(503); expect(await unavailable.json()).toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
    } finally {
      if (prior.directory === undefined) delete process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR; else process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR = prior.directory;
      if (prior.limit === undefined) delete process.env.RESUME_FOUNDRY_TAILOR_LIMIT; else process.env.RESUME_FOUNDRY_TAILOR_LIMIT = prior.limit;
      Object.assign(process.env, { NODE_ENV: prior.node });
    }
  });

  it.each([" 10", "10 ", "0x10", "1e3", "+10", "01"])("rejects non-decimal environment value %s", async (raw) => {
    const directory = await root(); const priorDirectory = process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR; const priorLimit = process.env.RESUME_FOUNDRY_TAILOR_LIMIT;
    try {
      process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR = directory; process.env.RESUME_FOUNDRY_TAILOR_LIMIT = raw;
      const response = enforcePublicRateLimit("tailor", { limit: 10, windowMs: 60_000 })!;
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
    } finally {
      if (priorDirectory === undefined) delete process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR; else process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR = priorDirectory;
      if (priorLimit === undefined) delete process.env.RESUME_FOUNDRY_TAILOR_LIMIT; else process.env.RESUME_FOUNDRY_TAILOR_LIMIT = priorLimit;
    }
  });
});

describe("rate-limit contract", () => {
  it("documents code and Retry-After for every protected public route", async () => {
    const spec = JSON.parse(await readFile(path.resolve("public/openapi.json"), "utf8")) as {
      paths: Record<string, { post?: { responses?: Record<string, { $ref?: string }> } }>;
      components: { responses: Record<string, { headers?: Record<string, { required?: boolean }> }> };
    };
    for (const route of ["/api/fetch-job", "/api/jobs/import", "/api/labor-market/onet", "/api/labor-market/bls-series", "/api/parse-resume", "/api/tailor"]) {
      expect(spec.paths[route]?.post?.responses?.["429"]?.$ref).toBe("#/components/responses/RateLimited");
      expect(spec.paths[route]?.post?.responses?.["503"]?.$ref).toBe("#/components/responses/RateLimitUnavailable");
    }
    expect(spec.components.responses.RateLimited.headers?.["Retry-After"]?.required).toBe(true);
    expect(spec.components.responses.RateLimitUnavailable.headers?.["Retry-After"]?.required).toBe(true);
  });
});
