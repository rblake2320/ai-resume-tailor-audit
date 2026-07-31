import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type ReceiptUse = { nonce: string; applicationId: string; provider: string; consumedAt: string };
type Ledger = { version: 1; consumed: ReceiptUse[] };
let queue: Promise<void> = Promise.resolve();
function target() { const value = process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER?.trim(); if (!value) throw new Error("RESUME_FOUNDRY_SUBMISSION_LEDGER must be configured."); return value; }
async function load(): Promise<Ledger> { try { return JSON.parse(await readFile(target(), "utf8")) as Ledger; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, consumed: [] }; throw error; } }
export async function consumeSubmissionApproval(use: ReceiptUse) {
  const prior = queue; let release!: () => void; queue = new Promise<void>((resolve) => { release = resolve; }); await prior;
  try {
    const ledger = await load(); if (ledger.consumed.some((entry) => entry.nonce === use.nonce)) throw new Error("Submission approval has already been consumed.");
    ledger.consumed.push(use); const file = target(); await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(ledger, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temp, file);
  } finally { release(); }
}
