import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, timingSafeEqual, verify } from "node:crypto";
import { z } from "zod";

/**
 * Opaque, issuer-approved vocabulary. The values intentionally carry no
 * program, customer, contract, clearance, technology, location, or duty data.
 * Adding a value requires governance review; callers cannot mint new values.
 */
export const APPROVED_ASSURANCE_CATEGORIES = ["RF-AC-001", "RF-AC-002", "RF-AC-003"] as const;
export const AssuranceCategorySchema = z.enum(APPROVED_ASSURANCE_CATEGORIES);

export const SensitiveClaimSchema = z.strictObject({
  sensitiveWorkParticipation: z.literal(true),
  assuranceCategory: AssuranceCategorySchema.optional(),
  timeRange: z.string().regex(/^\d{4}(?:-\d{4})?$/).optional(),
  attestationScope: z.enum(["employment", "accomplishment", "role-family"]),
  subjectBinding: z.string().regex(/^[a-f0-9]{64}$/),
  assertionCommitment: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type SensitiveClaim = z.infer<typeof SensitiveClaimSchema>;
export type ClaimKey = keyof SensitiveClaim;

type KeyLifecycle =
  | { status: "active"; retiredAt?: never; revokedAt?: never }
  | { status: "retired"; retiredAt: string; revokedAt?: never }
  | { status: "revoked"; revokedAt: string; retiredAt?: string };
export type IssuerKey = {
  issuerId: string;
  keyId: string;
  publicKey: string;
  allowedClaims: ClaimKey[];
  validFrom: string;
  validUntil: string;
} & KeyLifecycle;
export type TrustRegistry = { issuers: IssuerKey[] };
type Disclosure = [salt: string, key: ClaimKey, value: unknown];
export type SensitiveCredential = {
  profile: "RF-SENSITIVE-SD-1";
  id: string;
  issuerId: string;
  keyId: string;
  issuedAt: string;
  validFrom: string;
  validUntil: string;
  holderPublicKey: string;
  digests: string[];
  signature: string;
  disclosures: Disclosure[];
};
export type SensitivePresentation = {
  credential: Omit<SensitiveCredential, "disclosures">;
  disclosures: Disclosure[];
  audience: string;
  nonce: string;
  expiresAt: string;
  holderSignature: string;
};
export type CredentialStatus = { revokedCredentialIds: Set<string> };
export interface NonceStore {
  /** Must atomically return false when the nonce was consumed previously. */
  consume(nonce: string): boolean;
}

export class InMemoryNonceStore implements NonceStore {
  private readonly consumed = new Set<string>();
  consume(nonce: string) {
    if (this.consumed.has(nonce)) return false;
    this.consumed.add(nonce);
    return true;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function assertionCommitment(assertion: string, salt: string) {
  if (!salt) throw new Error("Assertion commitment salt is required.");
  return digest({ assertion: assertion.normalize("NFKC").trim(), salt });
}
export function generateAttestationKeyPair() {
  return generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
}

function parseDate(value: string, label: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date;
}

function signatureBytes(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{86}$/.test(value)) throw new Error(`${label} is invalid.`);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 64 || bytes.toString("base64url") !== value) throw new Error(`${label} is invalid.`);
  return bytes;
}

function keyCanIssue(key: IssuerKey, issuedAt: Date) {
  return key.status === "active"
    && parseDate(key.validFrom, "Issuer key validFrom") <= issuedAt
    && issuedAt < parseDate(key.validUntil, "Issuer key validUntil");
}

export function issueSensitiveCredential(input: {
  claim: SensitiveClaim;
  issuerKey: IssuerKey;
  issuerPrivateKey: string;
  holderPublicKey: string;
  issuedAt: Date;
  validFrom: Date;
  validUntil: Date;
}): SensitiveCredential {
  const claim = SensitiveClaimSchema.parse(input.claim);
  if (!keyCanIssue(input.issuerKey, input.issuedAt)) throw new Error("Only an active issuer key may issue a credential within its authorization interval.");
  if (input.validUntil <= input.validFrom || input.validFrom < input.issuedAt) throw new Error("Credential validity window is invalid.");
  const disclosures = Object.entries(claim).map(([key, value]) => [randomBytes(16).toString("base64url"), key as ClaimKey, value] satisfies Disclosure);
  const unsigned = {
    profile: "RF-SENSITIVE-SD-1" as const,
    id: randomUUID(),
    issuerId: input.issuerKey.issuerId,
    keyId: input.issuerKey.keyId,
    issuedAt: input.issuedAt.toISOString(),
    validFrom: input.validFrom.toISOString(),
    validUntil: input.validUntil.toISOString(),
    holderPublicKey: input.holderPublicKey,
    digests: disclosures.map(digest).sort(),
  };
  return { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), input.issuerPrivateKey).toString("base64url"), disclosures };
}

export function createSensitivePresentation(input: { credential: SensitiveCredential; disclose: ClaimKey[]; holderPrivateKey: string; audience: string; nonce: string; expiresAt: Date }): SensitivePresentation {
  if (!input.audience.trim() || !input.nonce.trim()) throw new Error("Audience and verifier nonce are required.");
  const { disclosures: _all, ...credential } = input.credential;
  const disclosures = input.credential.disclosures.filter((item) => input.disclose.includes(item[1]));
  const proof = { credentialId: credential.id, disclosureDigests: disclosures.map(digest).sort(), audience: input.audience, nonce: input.nonce, expiresAt: input.expiresAt.toISOString() };
  return { credential, disclosures, audience: input.audience, nonce: input.nonce, expiresAt: input.expiresAt.toISOString(), holderSignature: sign(null, Buffer.from(canonical(proof)), input.holderPrivateKey).toString("base64url") };
}

function keyCanVerifyCredential(key: IssuerKey, issuedAt: Date) {
  const withinAuthorization = parseDate(key.validFrom, "Issuer key validFrom") <= issuedAt && issuedAt < parseDate(key.validUntil, "Issuer key validUntil");
  if (!withinAuthorization || key.status === "revoked") return false;
  if (key.status === "retired") return issuedAt < parseDate(key.retiredAt, "Issuer key retiredAt");
  return true;
}

export function verifySensitivePresentation(input: {
  presentation: SensitivePresentation;
  registry: TrustRegistry;
  status: CredentialStatus;
  expectedAudience: string;
  expectedNonce: string;
  nonceStore: NonceStore;
  frozenAssertion?: { text: string; salt: string };
  now?: Date;
  requiredClaims?: ClaimKey[];
}) {
  const now = input.now ?? new Date();
  const presentation = input.presentation;
  const credential = presentation.credential;

  // Authenticate the issuer and holder before consulting or mutating replay state.
  if (credential.profile !== "RF-SENSITIVE-SD-1") throw new Error("Credential profile is invalid.");
  const issuedAt = parseDate(credential.issuedAt, "Credential issuedAt");
  const key = input.registry.issuers.find((entry) => entry.issuerId === credential.issuerId && entry.keyId === credential.keyId);
  if (!key || !keyCanVerifyCredential(key, issuedAt)) throw new Error("Issuer key is not trusted for this credential issuance.");
  const { signature, ...unsigned } = credential;
  if (!verify(null, Buffer.from(canonical(unsigned)), key.publicKey, signatureBytes(signature, "Issuer signature"))) throw new Error("Issuer signature is invalid.");

  const proof = { credentialId: credential.id, disclosureDigests: presentation.disclosures.map(digest).sort(), audience: presentation.audience, nonce: presentation.nonce, expiresAt: presentation.expiresAt };
  if (!verify(null, Buffer.from(canonical(proof)), credential.holderPublicKey, signatureBytes(presentation.holderSignature, "Holder signature"))) throw new Error("Holder binding proof is invalid.");

  if (presentation.audience !== input.expectedAudience || presentation.nonce !== input.expectedNonce) throw new Error("Presentation audience or nonce mismatch.");
  if (parseDate(presentation.expiresAt, "Presentation expiresAt") <= now) throw new Error("Presentation expired.");
  if (input.status.revokedCredentialIds.has(credential.id)) throw new Error("Credential is revoked.");
  if (parseDate(credential.validFrom, "Credential validFrom") > now || parseDate(credential.validUntil, "Credential validUntil") <= now) throw new Error("Credential is outside its validity window.");

  const disclosedKeys = new Set<ClaimKey>();
  for (const disclosure of presentation.disclosures) {
    if (disclosedKeys.has(disclosure[1])) throw new Error(`Claim ${disclosure[1]} was disclosed more than once.`);
    disclosedKeys.add(disclosure[1]);
    if (!credential.digests.includes(digest(disclosure))) throw new Error("Disclosure is not bound to the credential.");
    if (!key.allowedClaims.includes(disclosure[1])) throw new Error(`Issuer is not authorized for ${disclosure[1]}.`);
  }
  const claims = Object.fromEntries(presentation.disclosures.map(([, name, value]) => [name, value]));
  SensitiveClaimSchema.partial().parse(claims);
  for (const required of input.requiredClaims ?? []) if (!(required in claims)) throw new Error(`Required claim ${required} was not disclosed.`);

  if (claims.assertionCommitment !== undefined) {
    if (!input.frozenAssertion) throw new Error("Frozen assertion text and salt are required to verify its commitment.");
    const expected = Buffer.from(assertionCommitment(input.frozenAssertion.text, input.frozenAssertion.salt), "hex");
    const actual = Buffer.from(String(claims.assertionCommitment), "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Frozen assertion commitment does not match.");
  }

  // Last step: only a fully authenticated, policy-valid presentation burns a nonce.
  if (!input.nonceStore.consume(presentation.nonce)) throw new Error("Presentation nonce was already consumed.");
  return {
    valid: true as const,
    credentialId: credential.id,
    issuerId: credential.issuerId,
    claims,
    label: "Cryptographically verified employer attestation — not a security clearance or government endorsement",
  };
}
