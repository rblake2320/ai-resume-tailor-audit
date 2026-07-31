import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createDurableNonceStore, type NonceStore } from "./nonce-store";

type ReceiptUse = { nonce: string; applicationId: string; provider: string; consumedAt: string };

function ledgerPath() {
  const value = process.env.RESUME_FOUNDRY_SUBMISSION_LEDGER?.trim();
  if (!value) throw new Error("RESUME_FOUNDRY_SUBMISSION_LEDGER must be configured.");
  if (!path.isAbsolute(value)) throw new Error("RESUME_FOUNDRY_SUBMISSION_LEDGER must be an absolute path on durable storage.");
  return value;
}

/**
 * Nonce markers live beside the audit log, on whichever durable volume the
 * operator already chose, so replay protection needs no extra configuration.
 */
const nonceDirectoryFor = (ledger: string) => `${ledger}.nonces`;

/**
 * Claims a submission approval exactly once, then records the use.
 *
 * The previous implementation serialised a whole-file read-modify-write behind
 * a module-scoped promise queue. That serialises only within one Node process,
 * so two module instances — or two Next.js workers — each read `consumed: []`,
 * both proceeded to transmit, and one write was lost: a duplicate application
 * with no trace of the second. The claim is now a single atomic O_EXCL file
 * creation, and the audit is an append rather than a rewrite, so concurrent
 * records cannot overwrite one another either.
 */
export async function consumeSubmissionApproval(use: ReceiptUse, store?: NonceStore) {
  const ledger = ledgerPath();
  const nonces = store ?? createDurableNonceStore({ directory: nonceDirectoryFor(ledger) });

  // Claim first: if this loses, nothing has been transmitted and nothing is recorded.
  if (!nonces.consume(use.nonce)) throw new Error("Submission approval has already been consumed.");

  await mkdir(path.dirname(ledger), { recursive: true });
  await appendFile(ledger, `${JSON.stringify(use)}\n`, { encoding: "utf8", mode: 0o600 });
}
