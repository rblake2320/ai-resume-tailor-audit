import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./canonical-json.ts";

export const AUDIT_GENESIS = "0".repeat(64);

export type AgentAuditEntry = {
  id: string;
  at: string;
  actor: string;
  operation: string;
  allowed: boolean;
  reasonCode: string;
  inputHash: string;
  resultId: string | null;
  previousMac: string;
  mac: string;
};

type UnsignedAuditEntry = Omit<AgentAuditEntry, "mac">;

function auditKey(): Buffer {
  const key = process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY;
  if (!key || Buffer.byteLength(key, "utf8") < 32) throw new Error("RESUME_FOUNDRY_AGENT_AUDIT_KEY must contain at least 32 bytes.");
  return Buffer.from(key, "utf8");
}

export function assertAgentAuditConfigured(): void { void auditKey(); }

function mac(entry: UnsignedAuditEntry): string {
  return createHmac("sha256", auditKey()).update(canonicalJson(entry)).digest("hex");
}

export function appendAuthenticatedAudit(existing: readonly AgentAuditEntry[], entry: Omit<AgentAuditEntry, "previousMac" | "mac">): AgentAuditEntry {
  verifyAuthenticatedAudit(existing);
  const unsigned = { ...entry, previousMac: existing.at(-1)?.mac ?? AUDIT_GENESIS };
  return { ...unsigned, mac: mac(unsigned) };
}

export function verifyAuthenticatedAudit(entries: readonly AgentAuditEntry[]): void {
  let previousMac = AUDIT_GENESIS;
  for (const entry of entries) {
    if (entry.previousMac !== previousMac || !/^[a-f0-9]{64}$/u.test(entry.mac)) throw new Error("Agent audit authentication failed.");
    const { mac: supplied, ...unsigned } = entry;
    const expected = mac(unsigned);
    if (!timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"))) throw new Error("Agent audit authentication failed.");
    previousMac = supplied;
  }
}
