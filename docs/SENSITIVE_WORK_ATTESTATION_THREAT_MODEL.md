# Synthetic sensitive-work employer attestation

This profile lets an authorized employer issue a minimal acknowledgment of bounded sensitive-work participation. It is **not a security clearance, eligibility determination, access authorization, DISS record, classified-work description, or government endorsement**.

## Threats and controls

- **Issuer impersonation:** verifier accepts only a registered issuer/key authorized for each disclosed claim type and within its validity window.
- **Holder theft/substitution:** every credential binds a per-credential holder public key; each presentation requires its signature.
- **Replay:** verifier supplies an unpredictable nonce; presentation binds nonce, audience, expiry, credential, and disclosed digests. The verifier consumes the nonce atomically only after every signature, binding, validity, revocation, authorization, disclosure, and assertion check passes. Production deployments require a durable shared `NonceStore`; the included in-memory implementation is test/local-process only.
- **Over-disclosure:** the strict claim schema rejects program, customer, contract, clearance, technology, location, and duty details. `assuranceCategory` accepts only governance-approved opaque identifiers (`RF-AC-001` through `RF-AC-003`); issuer-controlled strings are rejected. Salted disclosures reveal only selected predicates.
- **Correlation:** holders should use a separate subject binding/key for each issuer relationship. Verifiers receive no hidden disclosure salts or subject binding unless explicitly selected.
- **Stale/revoked credentials:** active keys may issue and verify. Retired keys cannot issue and may verify only credentials issued inside their authorization interval and before retirement. Revoked keys always fail. Lifecycle timestamps keep rotation history explicit and serializable.
- **Verifier collusion:** audience-bound presentations cannot be replayed to a second audience; policy and legal controls are still needed because a verifier can copy information it legitimately sees.
- **Misleading clearance claims:** UI/output must use the exact label “Cryptographically verified employer attestation — not a security clearance or government endorsement.”
- **Forged résumé evidence:** the verifier must supply the exact frozen assertion text and salt, recompute the commitment, and compare it in constant time. A digest-shaped value alone is never accepted as evidence.

## Synthetic-only boundary

The `RF-SENSITIVE-SD-1` profile is a Resume Foundry test profile using Ed25519 and salted disclosure digests. It is not claimed to be interoperable with an external government or commercial credential wallet. Real deployment remains blocked until authorized government security, classification, legal, privacy, records, accessibility, and cryptographic reviewers approve the exact vocabulary, issuer authorization process, status service, key custody, and presentation profile. No classified or real clearance data belongs in this repository or its tests.

Standards/boundary references: W3C VC Data Model 2.0 (https://www.w3.org/TR/vc-data-model/), DCSA DISS FAQ (https://www.dcsa.mil/Systems-Applications/Defense-Information-System-for-Security-DISS/FAQs-DISS/), DCSA adjudication FAQ (https://www.dcsa.mil/Trust-Decision-Adjudications/FAQS-Trust-Decision-Adjudications/), and SF-312 (https://www.archives.gov/isoo/security-forms/sf312.pdf).
