import { randomUUID } from "node:crypto";
import { open, readFile, unlink, type FileHandle } from "node:fs/promises";

/**
 * Cross-process mutual exclusion for a whole-file read-modify-write.
 *
 * Acquisition uses O_CREAT|O_EXCL. Locks are never reclaimed automatically:
 * age cannot distinguish a dead owner from a slow, paused, or overloaded live
 * owner. An earlier age-based reclaim admitted multiple writers when valid
 * work exceeded the stale threshold.
 *
 * A crash can therefore leave an orphan. Recovery is deliberately operational
 * and fail-closed: stop every process that can use the store, then remove the
 * sibling `.lock` file before restarting one process. Never remove it while a
 * writer may still be alive.
 */
export async function withFileLock<T>(
  lockPath: string,
  work: () => Promise<T>,
  options: {
    timeoutMs?: number;
    /** @deprecated Ignored. Locks are never reclaimed from age alone. */
    staleAfterMs?: number;
  } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("File-lock timeout must be a positive integer.");
  }
  const deadline = Date.now() + timeoutMs;
  const ownerToken = randomUUID();
  let handle: FileHandle | undefined;

  for (;;) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(ownerToken, "utf8");
      await handle.sync();
      break;
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
        handle = undefined;
      }
      const code = (error as NodeJS.ErrnoException).code;
      // Windows reports EPERM rather than EEXIST while another process has the
      // lock open without delete sharing. Treat it as contention and retain the
      // same bounded, fail-closed timeout; ACL failures therefore never admit a
      // writer, although Windows reports them after the timeout rather than
      // immediately.
      const contended = code === "EEXIST" || (process.platform === "win32" && code === "EPERM");
      if (!contended) throw error;
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the durable store lock. If its owner crashed, stop every store process before removing the orphaned .lock file.");
      }
      // Jitter prevents independent processes from retrying in lockstep.
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 15)));
    }
  }

  let workError: unknown;
  try {
    return await work();
  } catch (error) {
    workError = error;
    throw error;
  } finally {
    await handle.close();
    const observed = await readFile(lockPath, "utf8").catch(() => null);
    if (observed === ownerToken) {
      await unlink(lockPath);
    } else if (workError === undefined) {
      throw new Error("Durable store lock ownership changed unexpectedly; the lock was left in place.");
    }
  }
}
