import { open, stat, unlink } from "node:fs/promises";

/**
 * Cross-process mutual exclusion for a whole-file read-modify-write.
 *
 * The agent store is read, mutated, and rewritten in full. That was serialised
 * only by a module-scoped promise queue, which holds within one Node process and
 * not between them — four concurrent processes each read the same store, all
 * four passed a daily limit of one, and three writes were lost.
 *
 * Acquisition is a single `open(O_CREAT|O_EXCL)`, the same atomic primitive the
 * nonce store uses. A lock older than `staleAfterMs` is reclaimed so a killed
 * process cannot wedge the store permanently.
 */
export async function withFileLock<T>(
  lockPath: string,
  work: () => Promise<T>,
  options: { timeoutMs?: number; staleAfterMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleAfterMs = options.staleAfterMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await reclaimIfStale(lockPath, staleAfterMs);
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the durable store lock.");
      // Jittered backoff so waiters do not retry in lockstep.
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 15)));
    }
  }

  try {
    return await work();
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}

async function reclaimIfStale(lockPath: string, staleAfterMs: number) {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > staleAfterMs) await unlink(lockPath).catch(() => undefined);
  } catch {
    // Already gone; the next acquisition attempt will win or lose cleanly.
  }
}
