import { z } from "zod";

export const CAREER_LEDGER_SCHEMA_VERSION = 1 as const;

export const CareerEventCategorySchema = z.enum([
  "project", "coursework", "paid_work", "volunteering", "caregiving",
  "club_team", "award", "certification", "responsibility", "feedback",
  "interest", "constraint", "reflection", "other",
]);
export const EvidenceClaimStateSchema = z.enum(["fact", "user_confirmed_inference", "unconfirmed_inference"]);
export const EvidenceVerificationSchema = z.enum(["self_reported", "artifact_attached", "third_party_attested"]);
export const CareerVisibilitySchema = z.enum([
  "private", "advisor_only", "guardian_visible", "packet_selectable", "public",
]);

export const CareerEvidenceRefSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["file", "url", "note", "credential", "attestation"]),
  label: z.string().min(1).max(300),
  digest: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  locator: z.string().max(2000).default(""),
});

export const CareerEventSchema = z.strictObject({
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  capturedAt: z.string().datetime(),
  category: CareerEventCategorySchema,
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(20_000),
  originalSource: z.string().max(20_000).default(""),
  claimState: EvidenceClaimStateSchema,
  verification: EvidenceVerificationSchema,
  skills: z.array(z.strictObject({
    name: z.string().min(1).max(200),
    state: EvidenceClaimStateSchema,
    source: z.enum(["user", "import", "ai_suggestion"]),
  })).default([]),
  measurableResult: z.string().max(2000).default(""),
  collaborators: z.array(z.string().min(1).max(300)).default([]),
  context: z.string().max(5000).default(""),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string().min(1).max(100)).default([]),
  occupationCodes: z.array(z.string().min(1).max(30)).default([]),
  evidence: z.array(CareerEvidenceRefSchema).default([]),
  visibility: CareerVisibilitySchema.default("private"),
  supersedesEventId: z.string().uuid().nullable().default(null),
  correctionReason: z.string().max(2000).default(""),
  previousHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const CareerLedgerSchema = z.strictObject({
  schemaVersion: z.literal(CAREER_LEDGER_SCHEMA_VERSION),
  ledgerId: z.string().uuid(),
  ownerId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  events: z.array(CareerEventSchema),
});

export type CareerEvent = z.infer<typeof CareerEventSchema>;
export type CareerLedger = z.infer<typeof CareerLedgerSchema>;
export type CareerEventInput = Omit<CareerEvent, "id" | "sequence" | "capturedAt" | "previousHash" | "hash">;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function random(size: number): Uint8Array { const value = new Uint8Array(size); crypto.getRandomValues(value); return value; }

export function createCareerLedger(ownerId: string, now = new Date()): CareerLedger {
  const timestamp = now.toISOString();
  return CareerLedgerSchema.parse({
    schemaVersion: CAREER_LEDGER_SCHEMA_VERSION,
    ledgerId: crypto.randomUUID(), ownerId, createdAt: timestamp, updatedAt: timestamp, events: [],
  });
}

/** Append-only: corrections are new events linked to the event they supersede. */
export async function appendCareerEvent(ledger: CareerLedger, input: CareerEventInput, now = new Date()): Promise<CareerLedger> {
  const parsed = CareerLedgerSchema.parse(ledger);
  if (input.supersedesEventId && !parsed.events.some((event) => event.id === input.supersedesEventId)) {
    throw new Error("A correction must reference an event in this ledger.");
  }
  if (input.supersedesEventId && !input.correctionReason.trim()) {
    throw new Error("A correction must explain why it supersedes the earlier event.");
  }
  const previousHash = parsed.events.at(-1)?.hash ?? null;
  const withoutHash: Omit<CareerEvent, "hash"> = {
    ...input, id: crypto.randomUUID(), sequence: parsed.events.length + 1,
    capturedAt: now.toISOString(), previousHash,
  };
  const event = CareerEventSchema.parse({ ...withoutHash, hash: await sha256(withoutHash) });
  return CareerLedgerSchema.parse({ ...parsed, updatedAt: now.toISOString(), events: [...parsed.events, event] });
}

export async function verifyCareerLedger(ledger: CareerLedger): Promise<{ valid: boolean; errors: string[] }> {
  const parsed = CareerLedgerSchema.safeParse(ledger);
  if (!parsed.success) return { valid: false, errors: ["Ledger schema validation failed."] };
  const errors: string[] = [];
  let previousHash: string | null = null;
  const ids = new Set<string>();
  for (const [index, event] of parsed.data.events.entries()) {
    if (event.sequence !== index + 1) errors.push(`Event ${event.id} has an invalid sequence.`);
    if (event.previousHash !== previousHash) errors.push(`Event ${event.id} breaks the hash chain.`);
    const { hash, ...withoutHash } = event;
    if (await sha256(withoutHash) !== hash) errors.push(`Event ${event.id} failed its integrity check.`);
    if (event.supersedesEventId && !ids.has(event.supersedesEventId)) errors.push(`Event ${event.id} supersedes a missing or later event.`);
    ids.add(event.id); previousHash = hash;
  }
  return { valid: errors.length === 0, errors };
}

export function currentCareerEvents(ledger: CareerLedger): CareerEvent[] {
  const superseded = new Set(ledger.events.flatMap((event) => event.supersedesEventId ? [event.supersedesEventId] : []));
  return ledger.events.filter((event) => !superseded.has(event.id));
}

export async function createDisclosurePacket(ledger: CareerLedger, eventIds: readonly string[]) {
  const selected = currentCareerEvents(ledger).filter((event) => eventIds.includes(event.id) && event.visibility !== "private");
  const events = selected.map(({ originalSource: _privateSource, collaborators: _privatePeople, ...safe }) => safe);
  const body = { schemaVersion: 1, sourceLedgerId: ledger.ledgerId, createdAt: new Date().toISOString(), events };
  return { ...body, checksum: await sha256(body) };
}

export const EncryptedCareerBackupSchema = z.strictObject({
  format: z.literal("resume-foundry-career-vault"), version: z.literal(1),
  kdf: z.literal("PBKDF2-SHA256"), iterations: z.number().int().min(100_000),
  salt: z.string(), iv: z.string(), ciphertext: z.string(),
});
export type EncryptedCareerBackup = z.infer<typeof EncryptedCareerBackupSchema>;

const subtle = globalThis.crypto.subtle;
const bytes = (value: string) => new TextEncoder().encode(value);
const b64 = (value: Uint8Array) => {
  let binary = ""; for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};
const unb64 = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await subtle.importKey("raw", bytes(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function exportEncryptedCareerLedger(ledger: CareerLedger, passphrase: string): Promise<EncryptedCareerBackup> {
  if (passphrase.length < 12) throw new Error("Use a backup passphrase of at least 12 characters.");
  const integrity = await verifyCareerLedger(ledger); if (!integrity.valid) throw new Error(integrity.errors.join(" "));
  const salt = random(16); const iv = random(12); const iterations = 310_000;
  const key = await deriveKey(passphrase, salt, iterations);
  const plaintext = bytes(JSON.stringify({ ledger, checksum: await sha256(ledger) }));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(iv).buffer }, key, new Uint8Array(plaintext).buffer);
  return { format: "resume-foundry-career-vault", version: 1, kdf: "PBKDF2-SHA256", iterations,
    salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}

export async function importEncryptedCareerLedger(backup: unknown, passphrase: string): Promise<CareerLedger> {
  const parsed = EncryptedCareerBackupSchema.parse(backup);
  try {
    const key = await deriveKey(passphrase, unb64(parsed.salt), parsed.iterations);
    const plaintext = await subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(unb64(parsed.iv)).buffer }, key,
      new Uint8Array(unb64(parsed.ciphertext)).buffer,
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as { ledger: unknown; checksum: string };
    const ledger = CareerLedgerSchema.parse(payload.ledger);
    if (await sha256(ledger) !== payload.checksum) throw new Error("Backup checksum mismatch.");
    const integrity = await verifyCareerLedger(ledger); if (!integrity.valid) throw new Error(integrity.errors.join(" "));
    return ledger;
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw new Error("Career backup could not be decrypted or failed integrity verification.");
  }
}
