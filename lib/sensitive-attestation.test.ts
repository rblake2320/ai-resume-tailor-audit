import { describe, expect, it } from "vitest";
import { assertionCommitment, createSensitivePresentation, generateAttestationKeyPair, issueSensitiveCredential, SensitiveClaimSchema, verifySensitivePresentation, type CredentialStatus, type TrustRegistry } from "./sensitive-attestation";

const issuer = generateAttestationKeyPair(); const holder = generateAttestationKeyPair();
const registry: TrustRegistry = { issuers: [{ issuerId: "synthetic-employer", keyId: "2026-a", publicKey: issuer.publicKey, allowedClaims: ["sensitiveWorkParticipation", "attestationScope", "subjectBinding", "assertionCommitment"], validFrom: "2025-01-01T00:00:00Z", validUntil: "2030-01-01T00:00:00Z", status: "active" }] };
const status: CredentialStatus = { revokedCredentialIds: new Set() };
const claim = { sensitiveWorkParticipation: true as const, attestationScope: "accomplishment" as const, subjectBinding: "a".repeat(64), assertionCommitment: assertionCommitment("Led an approved sensitive-work effort", "packet-salt") };
function credential() { return issueSensitiveCredential({ claim, issuerId: "synthetic-employer", keyId: "2026-a", issuerPrivateKey: issuer.privateKey, holderPublicKey: holder.publicKey, validFrom: new Date("2026-01-01"), validUntil: new Date("2028-01-01") }); }
function presentation(credential_ = credential(), nonce = "verifier-nonce") { return createSensitivePresentation({ credential: credential_, disclose: ["sensitiveWorkParticipation", "attestationScope", "assertionCommitment"], holderPrivateKey: holder.privateKey, audience: "prospective-employer", nonce, expiresAt: new Date("2026-06-01T00:05:00Z") }); }
function verifyOne(presentation_ = presentation(), overrides: Partial<Parameters<typeof verifySensitivePresentation>[0]> = {}) { const used = new Set<string>(); return verifySensitivePresentation({ presentation: presentation_, registry, status, expectedAudience: "prospective-employer", expectedNonce: "verifier-nonce", now: new Date("2026-06-01T00:00:00Z"), consumeNonce: (nonce) => { if (used.has(nonce)) return false; used.add(nonce); return true; }, requiredClaims: ["sensitiveWorkParticipation"], ...overrides }); }

describe("sensitive-work employer attestation", () => {
  it("rejects forbidden or detailed fields at schema boundary", () => {
    for (const forbidden of ["programName", "customer", "contract", "clearanceLevel", "technology", "location", "duties"]) expect(() => SensitiveClaimSchema.parse({ ...claim, [forbidden]: "SECRET" })).toThrow();
  });
  it("selectively discloses approved predicates without hidden subject binding", () => {
    const shown = presentation(); const result = verifyOne(shown);
    expect(result.valid).toBe(true); expect(result.claims).not.toHaveProperty("subjectBinding");
    expect(JSON.stringify(shown)).not.toContain(claim.subjectBinding); expect(result.label).toContain("not a security clearance");
  });
  it("binds presentations to holder, audience, nonce, and expiry", () => {
    expect(() => verifyOne(presentation(), { expectedAudience: "attacker" })).toThrow(/audience/);
    expect(() => verifyOne(presentation(), { expectedNonce: "other" })).toThrow(/nonce/);
    expect(() => verifyOne(presentation(), { now: new Date("2026-06-01T00:06:00Z") })).toThrow(/expired/);
    const tampered = presentation(); tampered.holderSignature = `${tampered.holderSignature.slice(0, -2)}AA`; expect(() => verifyOne(tampered)).toThrow(/Holder/);
  });
  it("rejects replay through verifier nonce consumption", () => {
    const shown = presentation(); const used = new Set<string>(); const consumeNonce = (nonce: string) => { if (used.has(nonce)) return false; used.add(nonce); return true; };
    const base = { presentation: shown, registry, status, expectedAudience: "prospective-employer", expectedNonce: "verifier-nonce", now: new Date("2026-06-01T00:00:00Z"), consumeNonce };
    expect(verifySensitivePresentation(base).valid).toBe(true); expect(() => verifySensitivePresentation(base)).toThrow(/already consumed/);
  });
  it("enforces issuer authorization, revocation, and key rotation", () => {
    const shown = presentation(); const restricted: TrustRegistry = { issuers: [{ ...registry.issuers[0], allowedClaims: ["sensitiveWorkParticipation"] }] };
    expect(() => verifyOne(shown, { registry: restricted })).toThrow(/not authorized/);
    expect(() => verifyOne(shown, { status: { revokedCredentialIds: new Set([shown.credential.id]) } })).toThrow(/revoked/);
    expect(() => verifyOne(shown, { registry: { issuers: [{ ...registry.issuers[0], status: "revoked" }] } })).toThrow(/not trusted/);
    expect(verifyOne(shown, { registry: { issuers: [{ ...registry.issuers[0], status: "retired" }] } }).valid).toBe(true);
  });
  it("verifies a salted commitment to the exact frozen resume assertion", () => {
    const result = verifyOne(); expect(result.claims.assertionCommitment).toBe(assertionCommitment("Led an approved sensitive-work effort", "packet-salt"));
    expect(result.claims.assertionCommitment).not.toBe(assertionCommitment("Changed assertion", "packet-salt"));
  });
});
