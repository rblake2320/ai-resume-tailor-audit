import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

export type RateLimitDecision = { allowed: boolean; retryAfterSeconds: number; remaining: number };

export type DurableFixedWindowOptions = {
  directory: string;
  scope: string;
  limit: number;
  windowMs: number;
  now?: () => number;
};

/** Cross-process, single-host fixed-window limiter using atomic slot files. */
export function createDurableFixedWindowLimiter(options: DurableFixedWindowOptions) {
  if (!path.isAbsolute(options.directory)) throw new Error("Rate-limit directory must be absolute.");
  if (!options.scope.trim()) throw new Error("Rate-limit scope is required.");
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 10_000) throw new Error("Rate-limit capacity must be an integer from 1 to 10000.");
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1_000) throw new Error("Rate-limit window must be at least one second.");
  const now = options.now ?? Date.now;
  const scope = createHash("sha256").update(options.scope).digest("hex");
  const scopeDirectory = path.join(options.directory, scope);
  mkdirSync(scopeDirectory, { recursive: true, mode: 0o700 });

  function take(): RateLimitDecision {
    const timestamp = now();
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error("Rate-limit clock returned an invalid timestamp.");
    const window = Math.floor(timestamp / options.windowMs);
    for (let slot = 0; slot < options.limit; slot += 1) {
      const marker = path.join(scopeDirectory, `${window}.${slot}.used`);
      try {
        const handle = openSync(marker, "wx", 0o600);
        closeSync(handle);
        prune(scopeDirectory, window);
        return { allowed: true, retryAfterSeconds: 0, remaining: options.limit - slot - 1 };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const retryMs = (window + 1) * options.windowMs - timestamp;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1_000)), remaining: 0 };
  }

  return { take };
}

export function configuredPublicRateLimiter(scope: string, defaults: { limit: number; windowMs: number }) {
  const configuredDirectory = process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR?.trim();
  if (!configuredDirectory && process.env.NODE_ENV === "production") {
    throw new Error("RESUME_FOUNDRY_RATE_LIMIT_DIR is required for production public endpoints.");
  }
  const prefix = `RESUME_FOUNDRY_${scope.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "_")}`;
  const rawLimit = process.env[`${prefix}_LIMIT`];
  const rawWindow = process.env[`${prefix}_WINDOW_MS`];
  const limit = rawLimit === undefined ? defaults.limit : Number(rawLimit);
  const windowMs = rawWindow === undefined ? defaults.windowMs : Number(rawWindow);
  return createDurableFixedWindowLimiter({
    directory: configuredDirectory || path.join(tmpdir(), "resume-foundry-rate-limits"),
    scope,
    limit,
    windowMs,
  });
}

function prune(directory: string, currentWindow: number): void {
  try {
    for (const name of readdirSync(directory)) {
      const match = /^(\d+)\.\d+\.used$/u.exec(name);
      if (match && Number(match[1]) < currentWindow - 1) rmSync(path.join(directory, name), { force: true });
    }
  } catch {
    // Cleanup is best-effort and never participates in admission.
  }
}
