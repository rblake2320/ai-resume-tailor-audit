import { describe, expect, it } from "vitest";
import {
  APPROVED_ASSURANCE_CATEGORIES,
  InMemoryNonceStore,
  SensitiveClaimSchema,
  assertionCommitment,
  createSensitivePresentation,
  generateAttestationKeyPair,
  issueSensitiveCredential,
  verifySensitivePresentation,
  type CredentialStatus,
  type IssuerKey,
  type SensitivePresentation,
  type TrustRegistry,
} from "./sensitive-attestation";

const issuer = generateAttestationKeyPair();
const otherIssuer = generateAttestationKeyPair();
const holder = generateAttestationKeyPair();
const activeKey: IssuerKey = {
  issuerId: "synthetic-employer", keyId: "2026-a", publicKey: issuer.publicKey,
  allowedClaims: ["sensitiveWorkParticipation", "attestationScope", "subjectBinding", "assertionCommitment", "assuranceCategory"],
  validFrom: "2025-01-01T00:00:00Z", validUntil: "2030-01-01T00:00:00Z", status: "active",
};
const registry: TrustRegistry = { issuers: [activeKey] };
const status: CredentialStatus = { revokedCredentialIds: new Set() };
const frozenAssertion = { text: "Led an approved sensitive-work effort", salt: "packet-salt" };
const claim = {
  sensitiveWorkParticipation: true as const,
  assuranceCategory: APPROVED_ASSURANCE_CATEGORIES[0],
  attestationScope: "accomplishment" as const,
  subjectBinding: "a".repeat(64),
  assertionCommitment: assertionCommitment(frozenAssertion.text, frozenAssertion.salt),
};
function credential(key = activeKey, privateKey = issuer.privateKey) {
  return issueSensitiveCredential({ claim, issuerKey: key, issuerPrivateKey: privateKey, holderPublicKey: holder.publicKey, issuedAt: new Date("2026-01-01"), validFrom: new Date("2026-01-01"), validUntil: new Date("2028-01-01") });
}
function presentation(credential_ = credential(), nonce = "verifier-nonce") {
  return createSensitivePresentation({ credential: credential_, disclose: ["sensitiveWorkParticipation", "attestationScope", "assertionCommitment", "assuranceCategory"], holderPrivateKey: holder.privateKey, audience: "prospective-employer", nonce, expiresAt: new Date("2026-06-01T00:05:00Z") });
}
function verifyOne(presentation_ = presentation(), overrides: Partial<Parameters<typeof verifySensitivePresentation>[0]> = {}) {
  return verifySensitivePresentation({ presentation: presentation_, registry, status, expectedAudience: "prospective-employer", expectedNonce: "verifier-nonce", now: new Date("2026-06-01T00:00:00Z"), nonceStore: new InMemoryNonceStore(), frozenAssertion, requiredClaims: ["sensitiveWorkParticipation"], ...overrides });
}
function mutateSignature(value: string) {
  const bytes = Buffer.from(value, "base64url");
  bytes[0] ^= 1;
  return bytes.toString("base64url");
}

describe("sensitive-work employer attestation", () => {
  it("rejects forbidden fields and category-shaped covert channels", () => {
    for (const forbidden of ["programName", "customer", "contract", "clearanceLevel", "technology", "location", "duties"]) expect(() => SensitiveClaimSchema.parse({ ...claim, [forbidden]: "SECRET" })).toThrow();
    for (const encoded of ["CUSTOMER_X", "TS_SCI", "PROGRAM-ALPHA", "AWS-CLOUD", "RF-AC-999"]) expect(() => SensitiveClaimSchema.parse({ ...claim, assuranceCategory: encoded })).toThrow();
  });

  it("selectively discloses approved predicates without hidden subject binding", () => {
    const shown = presentation(); const result = verifyOne(shown);
    expect(result.valid).toBe(true); expect(result.claims).not.toHaveProperty("subjectBinding");
    expect(JSON.stringify(shown)).not.toContain(claim.subjectBinding); expect(result.label).toContain("not a security clearance");
  });

  it("binds presentations to holder, audience, nonce, and expiry with deterministic tampering", () => {
    expect(() => verifyOne(presentation(), { expectedAudience: "attacker" })).toThrow(/audience/);
    expect(() => verifyOne(presentation(), { expectedNonce: "other" })).toThrow(/nonce/);
    expect(() => verifyOne(presentation(), { now: new Date("2026-06-01T00:06:00Z") })).toThrow(/expired/);
    const tampered = presentation(); tampered.holderSignature = mutateSignature(tampered.holderSignature);
    expect(() => verifyOne(tampered)).toThrow(/Holder/);
  });

  it("does not burn a nonce for wrong-key, altered-body, or invalid holder proofs", () => {
    const nonceStore = new InMemoryNonceStore();
    const valid = presentation();
    const wrongKeyRegistry: TrustRegistry = { issuers: [{ ...activeKey, publicKey: otherIssuer.publicKey }] };
    expect(() => verifyOne(valid, { registry: wrongKeyRegistry, nonceStore })).toThrow(/Issuer signature/);

    const altered = structuredClone(valid) as SensitivePresentation;
    altered.credential.validUntil = "2029-01-01T00:00:00.000Z";
    expect(() => verifyOne(altered, { nonceStore })).toThrow(/Issuer signature/);

    const badHolder = structuredClone(valid) as SensitivePresentation;
    badHolder.holderSignature = mutateSignature(badHolder.holderSignature);
    expect(() => verifyOne(badHolder, { nonceStore })).toThrow(/Holder/);
    expect(verifyOne(valid, { nonceStore }).valid).toBe(true);
  });

  it("rejects duplicate disclosed claim keys before consuming the nonce", () => {
    const nonceStore = new InMemoryNonceStore();
    const duplicatedCredential = credential();
    duplicatedCredential.disclosures.push(duplicatedCredential.disclosures[0]);
    const duplicated = presentation(duplicatedCredential);
    expect(() => verifyOne(duplicated, { nonceStore })).toThrow(/more than once/);
    expect(verifyOne(presentation(), { nonceStore }).valid).toBe(true);
  });

  it("atomically rejects replay after a valid presentation", () => {
    const shown = presentation(); const nonceStore = new InMemoryNonceStore();
    const base = { presentation: shown, registry, status, expectedAudience: "prospective-employer", expectedNonce: "verifier-nonce", now: new Date("2026-06-01T00:00:00Z"), nonceStore, frozenAssertion };
    expect(verifySensitivePresentation(base).valid).toBe(true); expect(() => verifySensitivePresentation(base)).toThrow(/already consumed/);
  });

  it("enforces issuer authorization, revocation, and rotation history", () => {
    const shown = presentation();
    expect(() => verifyOne(shown, { registry: { issuers: [{ ...activeKey, allowedClaims: ["sensitiveWorkParticipation"] }] } })).toThrow(/not authorized/);
    expect(() => verifyOne(shown, { status: { revokedCredentialIds: new Set([shown.credential.id]) } })).toThrow(/revoked/);
    expect(() => verifyOne(shown, { registry: { issuers: [{ ...activeKey, status: "revoked", revokedAt: "2026-05-01T00:00:00Z" }] } })).toThrow(/not trusted/);
    expect(verifyOne(shown, { registry: { issuers: [{ ...activeKey, status: "retired", retiredAt: "2026-02-01T00:00:00Z" }] } }).valid).toBe(true);
    expect(() => verifyOne(shown, { registry: { issuers: [{ ...activeKey, status: "retired", retiredAt: "2025-12-01T00:00:00Z" }] } })).toThrow(/not trusted/);
    const retiredKey = { ...activeKey, status: "retired" as const, retiredAt: "2026-02-01T00:00:00Z" };
    expect(() => credential(retiredKey)).toThrow(/Only an active/);
  });

  it("recomputes the commitment from the exact frozen assertion and salt", () => {
    expect(verifyOne().claims.assertionCommitment).toBe(claim.assertionCommitment);
    expect(() => verifyOne(presentation(), { frozenAssertion: { text: "Changed assertion", salt: frozenAssertion.salt } })).toThrow(/commitment/);
    expect(() => verifyOne(presentation(), { frozenAssertion: { text: frozenAssertion.text, salt: "wrong-salt" } })).toThrow(/commitment/);
    expect(() => verifyOne(presentation(), { frozenAssertion: undefined })).toThrow(/text and salt/);
  });
});
