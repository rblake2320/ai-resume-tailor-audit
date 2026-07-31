/** Three-process probe for the slow-live-owner lock regression. */
import { appendFile } from "node:fs/promises";
import { withFileLock } from "../file-lock.ts";

const [lockPath, logPath, id, holdText, staleText] = process.argv.slice(2);
const holdMs = Number(holdText);
const formerStaleMs = Number(staleText);

await withFileLock(lockPath, async () => {
  await appendFile(logPath, JSON.stringify({ event: "enter", id, at: Date.now() }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  await appendFile(logPath, JSON.stringify({ event: "exit", id, at: Date.now() }) + "\n");
}, { timeoutMs: 10_000, staleAfterMs: formerStaleMs });
