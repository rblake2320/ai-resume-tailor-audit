import { execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children = new Set<ChildProcess>();
const probe = path.join(import.meta.dirname, "testdata", "file-lock-probe.ts");
let root = "";

afterEach(async () => {
  for (const child of children) child.kill();
  children.clear();
  if (root) await rm(root, { recursive: true, force: true });
});

function runProbe(lock: string, log: string, id: string, holdMs: number, formerStaleMs: number) {
  return new Promise<void>((resolve, reject) => {
    const child = execFile(process.execPath, ["--experimental-strip-types", probe, lock, log, id, String(holdMs), String(formerStaleMs)], { timeout: 15_000 }, (error) => {
      children.delete(child);
      if (error) reject(error); else resolve();
    });
    children.add(child);
  });
}

async function waitForLines(log: string, count: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const lines = (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    if (lines.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} lock events.`);
}

describe("file lock", () => {
  it("never reclaims a slow live owner and serialises three real processes", async () => {
    root = await mkdtemp(path.join(tmpdir(), "foundry-file-lock-"));
    const lock = path.join(root, "store.lock");
    const log = path.join(root, "events.jsonl");
    const formerStaleMs = 100;

    const first = runProbe(lock, log, "first", 500, formerStaleMs);
    await waitForLines(log, 1);
    // Both waiters observe a lock older than the former reclaim threshold.
    const second = runProbe(lock, log, "second", 80, formerStaleMs);
    const third = runProbe(lock, log, "third", 80, formerStaleMs);
    await Promise.all([first, second, third]);

    const events = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { event: "enter" | "exit"; id: string; at: number });
    expect(events).toHaveLength(6);
    let active = 0;
    for (const event of events) {
      active += event.event === "enter" ? 1 : -1;
      expect(active).toBeGreaterThanOrEqual(0);
      expect(active).toBeLessThanOrEqual(1);
    }
    expect(active).toBe(0);
    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);
});
