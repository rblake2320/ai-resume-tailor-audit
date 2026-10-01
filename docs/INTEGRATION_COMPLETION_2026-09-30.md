# Integration completion — September 30, 2026

Local date: America/Chicago, September 30, 2026. Machine timestamps are UTC
(October 1). This follows the initial security/dependency review and the owner's
instruction to finish the disconnected product flows. The shipped target is a
single-operator loopback workshop. Public multi-user deployment is not enabled.

## Completed receiving paths

| Flow | Behavior | Observed acceptance |
|---|---|---|
| Career vault → tailoring | Explicitly selected, integrity-checked evidence enters the request and immutable packet; private links, collaborators, unconfirmed inferences and unselected entries are excluded. Selection is transient. Erasure revokes decrypted evidence. | **Worked:** production browser inspected the actual outgoing request and packet. Encrypted backup, wrong-key refusal and restore also passed. Generation output in this scenario was intercepted. |
| Browser tracker ↔ HTTP agent | Explicit review, PII consent and a separate human approval secret publish an exact validated snapshot. Revision conflicts refuse replacement. Tokens stay in component memory. MCP cannot use these operations. | **Worked:** production browser published one record to the actual private server, read it back, rejected a stale revision, and restored it into the receiving tracker. |
| Approved reminder → calendar file | Download an RFC5545 event with a 15-minute display alarm. Import the file into your calendar to enable delivery. | **Worked:** browser downloaded and inspected an approved reminder. No background browser notification was represented as delivered. |
| Google → job inbox, calendar and unsent drafts | Read at most ten matching alerts, review before local import; review and approve separate event/draft writes. Connection-bound, expiring sealed reviews and durable one-use nonces gate writes. Independent readback checks actual content. No send endpoint or automatic write retry. | **Worked:** 19 focused contract/transport/component tests, including native HTTP receiving fixtures. **Blocked:** Google account OAuth acceptance requires app-specific configuration and owner authorization. |
| Frozen packet → official submission | Browser reviews exact content and destination, obtains bound human approval and executes once. Server allowlists, authentication, nonce, audit and attempt state independently enforce admission. | **Worked:** built browser refused missing consent and absent allowlist with zero provider requests. Native receiving tests cover accepted fixtures, tampering, replay, timeouts and malformed receipts. |
| Lever official application | Fetch the actual form; match ordered required fields; upload the exact approved resume; submit the documented structured application; require HTTP201 and a provider application ID. Unknown forms and invalid upload receipts refuse application submission. | **Worked:** native HTTP form/upload/application fixture and adversarial cases. The old flat JSON adapter failed against this contract and was replaced. No real employment application was sent. |
| Public job board → inbox → tailoring | Greenhouse reads bounded metadata, hydrates twenty details in groups of at most four, and exposes explicit pagination. UI requests match the strict route schema. Lever public imports remain bounded. | **Worked:** live built browser saved 40 unique jobs from a 636-posting Greenhouse board, selected one and populated its exact 10,363-character description. Live Lever route imported 100 jobs. No model or employer writes. |
| BLS → career evidence | Official numeric values remain numeric; an official dash becomes null, preserving the missing period and footnotes. UI reports missing values separately. Time series are not occupational projections. | **Worked:** real built API loaded all twelve 2025 unemployment periods: eleven numeric values and October missing. Regression tests reject blank, NaN, infinite and arbitrary text values. |
| Private local startup | `npm run start:local` binds 127.0.0.1:3100, checks Windows ACLs and provisions durable private stores and four distinct credentials. Locked, fsynced atomic credential initialization reuses the same configuration on restart. | **Worked:** actual launcher passed five ACL paths, served the page/guide/about/capabilities and admitted an authenticated workspace read. Restart reused existing credentials. |

## Verification and retained evidence

`npm run verify`: lint, typecheck, **599 tests across 67 files**, production build
and dependency audit passed. `npm run test:browser`: **17 production browser
scenarios passed**, including responsive layouts, malformed-stream refusal,
edit/print, job deduplication, frozen packets, selected evidence, vault recovery,
calendar download, and the real agent bridge. Screenshots were visually reviewed.
Generation in that suite uses deliberately intercepted provider output.

The independent security receiving suite passed **57 tests across eight files**.
Most unit tests use fixtures; native HTTP, filesystem/ACL, process and production
browser checks are identified separately in their evidence. A fixture receipt
is never recorded as a Google-account or employer receipt. Security-team program
status remains `NOT_ASSESSMENT_READY` / `TRAINING_OR_ENGINEERING_USE_ONLY`.

Current evidence is retained under [evidence/2026-09-30](evidence/2026-09-30):
`integration-verification.json`, `integration-tests.txt`,
`integration-browser.json`, `live-public-sources.json`, `bls-public-retest.json`,
`local-launcher-acceptance.json`, `anthropic-auth-check.json`,
`optional-provider-preflight.json`, and the Google/Lever/security transcripts.
The original failed Greenhouse and BLS checks remain alongside their successful
retests. No credentials, real resumes or decrypted owner data are included.

## Credentialed acceptance remaining

**Blocked — paid Anthropic generation:** the same app's existing key authenticated
with HTTP200 on the free models endpoint and its configured model is available.
One synthetic production-browser generation is prepared with an 8,192-output-token
cap and zero automatic retries. It requires explicit approval to consume credits:
`npm run test:browser -- --live-generation-approved`. The earlier first-checkpoint
report that no app key existed is superseded by this check.

**Blocked — Google account workflows:** actual status reports `configured:false`
and `connected:false`. Set the app's Google OAuth client ID, secret and exact
redirect URI in ignored `.env.local`, then authorize the chosen account/scopes.
The local launcher supplies the private connection-encryption key. Account reads,
event readback and unsent-draft readback must then be exercised through the UI.

**Blocked — O*NET and USAJOBS live reads:** actual routes returned HTTP503 with
missing app-specific provider credentials. Add their documented keys, plus the
USAJOBS user agent, before running their read-only acceptance.

**Blocked — real employer submission:** no authorized employer test endpoint,
provider credentials or explicit permission to submit an application are configured.
An employer sandbox is required for credentialed receiving acceptance; do not send
an unwanted real application as a smoke test.

These are exact blocked checks, rather than failed or passed external outcomes.
The work does not claim to cover every competitor's pain point or predict hiring
success. Laya remains an optional offline advisory CLI using the exact
`convaiinnovations/laya` checkpoint; it receives short structured public excerpts,
not owner resumes or screenshots, and cannot authorize or execute actions.

## Contract sources

Lever's official [developer documentation](https://hire.lever.co/developer/documentation)
defines the form/upload/structured application path. BLS documents the official
dash for missing October 2025 values in its [shutdown methodology note](https://www.bls.gov/cps/methods/2025-federal-government-shutdown-impact-cps.htm).

## Run locally

```sh
npm ci
npm run verify
npm run start:local
```

Open <http://localhost:3100>. App provider keys belong in ignored `.env.local`.
Optional bridge credentials are in the launcher-reported private `local-config.json`;
do not paste them into chat, screenshots or Git. Preserve that file for restart
and recovery. A crash leaving a store lock requires stopping all writers and
checking the orphan before removing it; never reclaim a live lock based on age.
