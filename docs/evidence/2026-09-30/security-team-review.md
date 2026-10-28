# Independent application-security engineering review

**TRAINING_OR_ENGINEERING_USE_ONLY**

Date: 2026-09-30. Scope: isolated Resume Foundry checkout, synthetic local inputs, local HTTP fixtures, code review and automated negative tests. No real applicant data, employer submission, OAuth authorization, provider request or attack against an external system occurred. This is an engineering review, not an assurance assessment or certification. The security-team operating guide currently marks its program NOT_ASSESSMENT_READY.

## Method and actual tools

- Read `C:/dev/engineering-standards/CONSTITUTION.md`, `C:/Users/techai/security-team/OPERATING.md` and `00-shared/24_application_security_baseline.md`.
- Executed `python C:/Users/techai/security-team/00-shared/tools/validate_appsec_baseline.py`: **Worked**, baseline catalog structure has 10 controls, negative tests, owners and document parity. Evidence: `security-team-baseline.txt`. This tool validates the security-team catalog; it does not scan or approve Resume Foundry.
- Independently inspected inbound HTTP limits, agent authorization, public limits, Google OAuth, submission approvals, provider transport, SSRF and security headers against the baseline.
- Executed new negative tests before repairs: **Failed**, all four tested controls failed. Evidence: `security-team-regressions-before.txt`.
- Repaired the boundaries and ran OAuth/job/submission regression suites: **Worked**, 36/36 tests. Evidence: `security-team-regressions-after.txt`.
- Executed actual native-fetch requests against disposable loopback HTTP fixtures: **Worked**, redirect denial prevented a synthetic POST reaching a second endpoint (0 requests), chunked response exceeded its 1,024-byte fixture budget and was rejected, and a peer returning no headers was aborted at the configured 15-second deadline. 3/3 tests; evidence: `security-team-local-transport.txt`.
- Executed existing and new HTTP/agent/nonce/submission/rate-limit/security-header/SSRF/CLI-compatibility boundary tests: **Worked**, 85/85 tests across 12 files. Evidence: `security-team-boundary-suite.txt`.

## Observed findings and repairs

| Finding | Observed before | Repair and regression | Baseline |
|---|---|---|---|
| DNS validation was detached from connection | `safeFetch` discarded validated IPs and passed hostname to a transport performing another DNS lookup. Independent synthetic regression demonstrated no pinning. | A per-hop pinned dispatcher binds connection resolution to the validated address set, retaining the original host for Host and TLS SNI. See SSRF evidence and tests below. | APP-07 |
| Inherited OAuth feature properties accepted | `constructor`, `toString`, `__proto__` passed the `in` membership check. | `Object.hasOwn` enforces the supported feature map. Negative tests reject every inherited name. | APP-01, APP-04 |
| OAuth token response trusted truthiness | A numeric access token was accepted; malformed expiry and refresh-token types lacked a runtime contract. | Runtime Zod schema validates nonempty string tokens, positive bounded integer expiry, string scopes and Bearer type before storage. Negative tests reject wrong types and negative expiry. | APP-06 |
| Fixed-destination providers had unbounded HTTP reads | Job connector accepted a declared 999,999,999-byte response and supplied no deadline or redirect policy. | Shared `provider-http.ts` sets a 15-second deadline and `redirect: error`; JSON reads cap 8 MiB for job/provider metadata and 64 KiB for token/draft responses. Failed/retried/status-only bodies are cancelled. Job, submission and OAuth connectors use the shared control. | APP-06, APP-08 |
| New helper import broke Node strip-types CLI path | Extended security sweep found submission child processes exiting 1 instead of expected 17 after a transitive import reached an unsupported constructor parameter property. | Replaced the `HttpLimitError` parameter property with an explicit field assignment. Reran submission and CLI compatibility regressions in the 85-test boundary suite. | Engineering R2, R13 |

Existing tests covered literal/private SSRF addresses, requested body byte limits, same-origin disconnect, bearer authorization, signed packet binding, nonce replay, crash-interrupted submission state, fail-closed rate-limit configuration and CSP construction. The extended boundary suite reran those controls. New tests include both injected provider responses and real local transport; the 3 provider local-transport scenarios use native sockets, while the 36 targeted connector tests use synthetic/injected responses.

## Deployment boundary and review ownership

The anonymous browser workshop intentionally has no multi-user account isolation; persistent bearer agent operations are a separate server-authorized surface. Existing durable rate limits coordinate workers on one host. The documented local startup binds loopback. Public exposure and multi-host use require a concrete deployment review and configured infrastructure; this change does not enable either surface or issue a readiness claim.

Owner of this engineering review: independent security-review agent, operating in the owner's authorized local application-review scope. Receiving implementation: Resume Foundry maintainer. The negative tests are retained executable controls. Remaining provider authorization/live acceptance tests are blocked by unavailable explicitly authorized credentials and the prohibition on real submissions in this review scope; no provider readiness outcome was inferred from fixtures.

## SSRF transport evidence

**Failed before repair:** 4/4 independent pinning regressions, retained in `ssrf-pinning-red.txt`. **Worked after repair:** 12/12 SSRF tests, including actual Node global-fetch / Undici Agent / local synthetic socket transport. The fixture observed one validation DNS lookup, the pinned approved address, preserved `jobs.example` Host header, and dispatcher close completing after streamed body consumption. Evidence: `ssrf-pinning-green.txt`, `ssrf-transport-green.txt`.

The initial Undici 8.11.2 candidate passed injected tests but **Failed** native transport because its dispatcher handler contract differed from Node 24 built-in fetch (`invalid onRequestStart method`). The compatible latest 7.x dependency, `undici ^7.30.0`, passed the same real transport scenario. This is why the compatibility decision follows executed transport evidence rather than the highest major version. Official dispatcher documentation: https://undici.nodejs.org/api/Dispatcher.

All tests use injected/synthetic hosts and local fixtures. No externally controlled DNS server or public destination was attacked. This proves the implemented connection pinning and local lifecycle behavior, with hostname retention observed directly; TLS SNI follows the unchanged request hostname rather than an IP-rewritten URL.

## Windows hosted-runner ownership correction

Hosted Windows CI exposed a freshly created inherited child whose owner was Administrators despite an otherwise correct service/System/Administrators-only DACL (`windows-ci-inherited-child.txt`). Microsoft's object-ownership documentation explains that a new object's owner derives from the creator's token: https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object.

**Failed before correction:** executed the committed pre-fix PowerShell security function against the same nine Windows security descriptors as the new regression; Administrators- and System-owned descendants were rejected. Evidence: `windows-acl-owner-policy-red.txt`.

**Worked after correction:** 18/18 new and existing Windows ACL tests on this machine. The new test executes the shipped PowerShell `Get-SecurityResult` against nine real in-memory Windows security descriptors without elevation. It accepts descendants owned by the existing full-control identities (service, System, Administrators); configured roots/files still require exact service ownership and protected inheritance. It rejects a foreign Users owner, an extra allowed principal, a deny ACE and missing required full control. Existing native filesystem ACL, junction and deny-rule tests also pass. Evidence: `windows-acl-owner-policy-green.txt`.

Security rationale: owner authority to alter DACLs adds no new access for these descendant owners because every accepted identity already has required effective FullControl, including WRITE_DAC and WRITE_OWNER. This change trusts no additional identity, weakens no root/configured-file condition and skips no hosted Windows test. The hosted CI rerun is owned by the parent implementation agent and remains separately recorded.
