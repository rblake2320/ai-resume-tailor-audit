import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Single-use nonce claim.
 *
 * `consume` must return `true` for exactly one caller per nonce, across every
 * process sharing the store. The previous submission ledger used a
 * module-scoped promise queue plus a read-modify-write of one JSON file, which
 * serialises only within a single Node process — two module instances (or two
 * Next.js workers) both consumed the same nonce and one write was lost.
 *
 * Synchronous by design so callers can consume a nonce as the last step of an
 * already-synchronous verification path without introducing an await point.
 */
export interface NonceStore {
  consume(nonce: string): boolean;
}

/** Volatile store for unit tests. Never use in a deployment. */
export function createInMemoryNonceStore(): NonceStore {
  const used = new Set<string>();
  return {
    consume(nonce) {
      if (used.has(nonce)) return false;
      used.add(nonce);
      return true;
    },
  };
}

export interface DurableNonceStoreOptions {
  /** Absolute directory on durable, access-controlled storage. */
  directory: string;
  /**
   * Retention for consumed markers. Must exceed the maximum lifetime of
   * anything the nonce protects, or pruning would re-open a replay window.
   * Omit to retain markers forever.
   */
  ttlMs?: number;
}

const MIN_TTL_MS = 60_000;

/**
 * Cross-process durable store.
 *
 * Atomicity comes from a single `open(O_CREAT|O_EXCL)` per nonce — the marker
 * file either did not exist and this caller created it, or it existed and this
 * caller loses. There is no read-then-write window for a concurrent process to
 * interleave with, and no lock to leak on crash.
 *
 * The filename is a SHA-256 hex digest of the nonce, so an attacker-supplied
 * nonce cannot traverse paths, collide with a reserved device name, or exceed
 * the filesystem's name length limit.
 */
export function createDurableNonceStore(options: DurableNonceStoreOptions): NonceStore {
  const directory = options.directory?.trim();
  if (!directory) throw new Error("A durable nonce store requires an absolute directory.");
  if (!path.isAbsolute(directory)) throw new Error("The nonce store directory must be an absolute path.");
  if (options.ttlMs !== undefined && (!Number.isFinite(options.ttlMs) || options.ttlMs < MIN_TTL_MS)) {
    throw new Error(`A nonce store ttlMs must be at least ${MIN_TTL_MS}ms so pruning cannot re-open a replay window.`);
  }

  const markerFor = (nonce: string) =>
    path.join(directory, `${createHash("sha256").update(nonce, "utf8").digest("hex")}.used`);

  let ensured = false;
  const ensureDirectory = () => {
    if (ensured) return;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    ensured = true;
  };

  // Per-instance so one store's sweep cannot suppress another's.
  let lastPruneAt = 0;

  return {
    consume(nonce) {
      if (typeof nonce !== "string" || nonce.length === 0) throw new Error("A nonce is required.");
      ensureDirectory();
      if (options.ttlMs !== undefined && Date.now() - lastPruneAt >= PRUNE_INTERVAL_MS) {
        lastPruneAt = Date.now();
        prune(directory, options.ttlMs);
      }
      try {
        // O_CREAT|O_EXCL — the atomic claim. EEXIST means someone else won.
        closeSync(openSync(markerFor(nonce), "wx", 0o600));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    },
  };
}

const PRUNE_INTERVAL_MS = 60_000;

function prune(directory: string, ttlMs: number) {
  const now = Date.now();
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".used")) continue;
    const file = path.join(directory, entry);
    try {
      if (now - statSync(file).mtimeMs > ttlMs) unlinkSync(file);
    } catch {
      // A concurrent pruner removed it, or it is not ours to remove.
    }
  }
}

/**
 * Store backed by `RESUME_FOUNDRY_NONCE_STORE`. Fails closed when unset rather
 * than silently degrading to per-process memory, which would make replay
 * protection depend on how many workers happen to be running.
 */
export function configuredNonceStore(ttlMs?: number): NonceStore {
  const directory = process.env.RESUME_FOUNDRY_NONCE_STORE?.trim();
  if (!directory) {
    throw new Error("RESUME_FOUNDRY_NONCE_STORE must be configured with an absolute durable directory for replay protection.");
  }
  return createDurableNonceStore({ directory, ttlMs });
}
