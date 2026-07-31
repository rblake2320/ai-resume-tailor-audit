import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { z } from "zod";

export const SensitiveClaimSchema = z.strictObject({
  sensitiveWorkParticipation: z.literal(true),
  assuranceCategory: z.string().regex(/^[A-Z0-9_-]{1,32}$/).optional(),
  timeRange: z.string().regex(/^\d{4}(?:-\d{4})?$/).optional(),
  attestationScope: z.enum(["employment", "accomplishment", "role-family"]),
  subjectBinding: z.string().regex(/^[a-f0-9]{64}$/),
  assertionCommitment: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type SensitiveClaim = z.infer<typeof SensitiveClaimSchema>;
type ClaimKey = keyof SensitiveClaim;
export type IssuerKey = { issuerId: string; keyId: string; publicKey: string; allowedClaims: ClaimKey[]; validFrom: string; validUntil: string; status: "active" | "retired" | "revoked" };
export type TrustRegistry = { issuers: IssuerKey[] };
type Disclosure = [salt: string, key: ClaimKey, value: unknown];
export type SensitiveCredential = { profile: "RF-SENSITIVE-SD-1"; id: string; issuerId: string; keyId: string; validFrom: string; validUntil: string; holderPublicKey: string; digests: string[]; signature: string; disclosures: Disclosure[] };
export type SensitivePresentation = { credential: Omit<SensitiveCredential, "disclosures">; disclosures: Disclosure[]; audience: string; nonce: string; expiresAt: string; holderSignature: string };
export type CredentialStatus = { revokedCredentialIds: Set<string> };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`; }
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function assertionCommitment(assertion: string, salt: string) { return digest({ assertion: assertion.normalize("NFKC").trim(), salt }); }
export function generateAttestationKeyPair() { return generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }); }

export function issueSensitiveCredential(input: { claim: SensitiveClaim; issuerId: string; keyId: string; issuerPrivateKey: string; holderPublicKey: string; validFrom: Date; validUntil: Date }): SensitiveCredential {
  const claim = SensitiveClaimSchema.parse(input.claim); if (input.validUntil <= input.validFrom) throw new Error("Credential validity window is invalid.");
  const disclosures = Object.entries(claim).map(([key, value]) => [randomBytes(16).toString("base64url"), key as ClaimKey, value] satisfies Disclosure);
  const unsigned = { profile: "RF-SENSITIVE-SD-1" as const, id: randomUUID(), issuerId: input.issuerId, keyId: input.keyId,
    validFrom: input.validFrom.toISOString(), validUntil: input.validUntil.toISOString(), holderPublicKey: input.holderPublicKey,
    digests: disclosures.map(digest).sort() };
  return { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), input.issuerPrivateKey).toString("base64url"), disclosures };
}

export function createSensitivePresentation(input: { credential: SensitiveCredential; disclose: ClaimKey[]; holderPrivateKey: string; audience: string; nonce: string; expiresAt: Date }): SensitivePresentation {
  if (!input.audience.trim() || !input.nonce.trim()) throw new Error("Audience and verifier nonce are required.");
  const { disclosures: _all, ...credential } = input.credential;
  const disclosures = input.credential.disclosures.filter((item) => input.disclose.includes(item[1]));
  const proof = { credentialId: credential.id, disclosureDigests: disclosures.map(digest).sort(), audience: input.audience, nonce: input.nonce, expiresAt: input.expiresAt.toISOString() };
  return { credential, disclosures, audience: input.audience, nonce: input.nonce, expiresAt: input.expiresAt.toISOString(), holderSignature: sign(null, Buffer.from(canonical(proof)), input.holderPrivateKey).toString("base64url") };
}

export function verifySensitivePresentation(input: { presentation: SensitivePresentation; registry: TrustRegistry; status: CredentialStatus; expectedAudience: string; expectedNonce: string; now?: Date; consumeNonce: (nonce: string) => boolean; requiredClaims?: ClaimKey[] }) {
  const now = input.now ?? new Date(); const presentation = input.presentation; const credential = presentation.credential;
  if (presentation.audience !== input.expectedAudience || presentation.nonce !== input.expectedNonce) throw new Error("Presentation audience or nonce mismatch.");
  if (new Date(presentation.expiresAt) <= now) throw new Error("Presentation expired.");
  if (!input.consumeNonce(presentation.nonce)) throw new Error("Presentation nonce was already consumed.");
  if (input.status.revokedCredentialIds.has(credential.id)) throw new Error("Credential is revoked.");
  if (new Date(credential.validFrom) > now || new Date(credential.validUntil) <= now) throw new Error("Credential is outside its validity window.");
  const key = input.registry.issuers.find((entry) => entry.issuerId === credential.issuerId && entry.keyId === credential.keyId);
  if (!key || key.status === "revoked" || new Date(key.validFrom) > now || new Date(key.validUntil) <= now) throw new Error("Issuer key is not trusted for this time and scope.");
  const { signature, ...unsigned } = credential;
  if (!verify(null, Buffer.from(canonical(unsigned)), key.publicKey, Buffer.from(signature, "base64url"))) throw new Error("Issuer signature is invalid.");
  for (const disclosure of presentation.disclosures) {
    if (!credential.digests.includes(digest(disclosure))) throw new Error("Disclosure is not bound to the credential.");
    if (!key.allowedClaims.includes(disclosure[1])) throw new Error(`Issuer is not authorized for ${disclosure[1]}.`);
  }
  const claims = Object.fromEntries(presentation.disclosures.map(([, name, value]) => [name, value])); SensitiveClaimSchema.partial().parse(claims);
  for (const required of input.requiredClaims ?? []) if (!(required in claims)) throw new Error(`Required claim ${required} was not disclosed.`);
  const proof = { credentialId: credential.id, disclosureDigests: presentation.disclosures.map(digest).sort(), audience: presentation.audience, nonce: presentation.nonce, expiresAt: presentation.expiresAt };
  if (!verify(null, Buffer.from(canonical(proof)), credential.holderPublicKey, Buffer.from(presentation.holderSignature, "base64url"))) throw new Error("Holder binding proof is invalid.");
  return { valid: true as const, credentialId: credential.id, issuerId: credential.issuerId, claims,
    label: "Cryptographically verified employer attestation — not a security clearance or government endorsement" };
}
