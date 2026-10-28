# Private tester pilot — 2026-10-01

TRAINING_OR_ENGINEERING_USE_ONLY. This is a bounded pilot implementation and receiving-side engineering evidence, not a certification or security assurance.

This Worker is the invite-only public gateway. A dedicated local Node 24 application runs behind a separate Cloudflare quick tunnel. Only the owner deploys it. The native application independently requires the origin secret on every path, including static assets; direct tunnel access must return 401. Worker upstream selection permits only an HTTPS root URL at a single `*.trycloudflare.com` host. A stopped host or changed tunnel requires an owner configuration update; the public Worker address remains stable.

Authentication uses ten independently generated, high-entropy invite codes, SHA-256 hashes in D1, an eight-hour signed HttpOnly Secure SameSite=Lax session cookie, and a revocable D1 session row. Invite expiry or disable revokes already-issued sessions. Owner administration uses a separate secret and one-hour role-bound cookie. Codes never go in URLs. Login/consent/post/delete operations require a matching Origin and same-origin Fetch Metadata when present. The application receives only the authenticated participant pseudonym and shared origin header. Tester cookies, authorization, caller-supplied pseudonyms, API keys, IP headers and other privileged headers are not forwarded.

Only safe public page/static GET/HEAD requests and the explicitly allowed resume/job/market POST routes are proxied. Agent execution, connections, official submissions and attestations are unavailable. Incoming bodies are bounded before forwarding. Origin redirects are rejected. Upstream Set-Cookie and permissive CORS headers are removed. Local acceptance uses a Miniflare outbound service mapped to a disposable loopback HTTP fixture; the shipped Worker uses normal fetch and contains no test transport override.

Generation defaults off. Enabling it requires both `PILOT_AI_ENABLED=true` and `PILOT_AI_PROVIDER=ollama`; the native app must separately enforce its configured local provider. This gateway cannot enable paid providers with the flag alone. Default admission limits are three generations per tester per UTC day and ten globally. Atomic D1 admission is taken before forwarding; uncertain outcomes are never retried or refunded automatically. `PILOT_AI_PER_TESTER_PER_DAY` must be 1–10, global 1–100. Local generation remains subject to host capacity and native request limits.

Feedback/usage collection defaults off and requires explicit versioned consent. D1 stores whitelisted event names/numeric enums, a client-generated analytics session UUID, pseudonymous participant ID, reviewed ratings/outcomes and expressly approved written comments capped at 2,000 characters. No résumé/job samples, raw inputs, URLs, provider errors, email addresses, IPs or user agents are collected by these schemas. Feedback rejects obvious email/link/SSN patterns; testers still must review free text and avoid identifying details. This is not a comprehensive PII detector. Platform infrastructure may process network metadata independently; Worker observability is disabled and application code does not log requests or payloads.

Operational invite hashes, authentication sessions, consent version/time and abuse/budget counters are necessary even when telemetry consent is off. Withdrawing consent deletes that tester's events and feedback and clears their consent receipt. It preserves other testers and short-lived operational admissions, so withdrawal/reconsent cannot reset limits. Daily caps are 500 events and 20 feedback submissions per tester. Scheduled cleanup removes events/feedback older than 30 days, admissions older than two days and expired sessions. Expiring invite configuration and participant pseudonyms remain owner-managed authentication records; no text telemetry is retained there.

Owner `/pilot/admin` shows a 30-day coverage range, consenting count, completion/error cards, step counts, average ratings and safely rendered reviewed comments. JSON download exports the current page. `/api/pilot/admin/export?offset=0` returns at most 1,000 events and 1,000 feedback rows, with `nextOffset`; coverage, event counts and rating summary cover all retained opted-in data. Raw record details are secondary. Event counts are instrumented usage signals, not independently verified employment outcomes.

## Setup and operation

1. `npm ci --prefix pilot`; `npm test --prefix pilot` runs actual workerd/D1/native receiving and secured native seed acceptance.
2. From the repository, `node pilot/scripts/invite-seed.mjs` creates `.resume-foundry/pilot/operator/owner-secrets.json` and hash-only SQL. Or supply `--output-dir <absolute-directory>`. On Windows the shipped ACL gate secures the directory before any generation/write; Linux uses mode 0700/0600. Exclusive lock, fsynced temporary files and non-overwriting hard-link publication refuse an existing bundle. Protect/share each invite privately; never commit operator files.
3. Owner provisions dedicated D1 and applies **both** migrations. Apply the hash-only seed once; do not regenerate deployed invite credentials. Secrets SESSION_SECRET, ORIGIN_SECRET and ADMIN_SECRET are loaded from the private owner bundle via Wrangler secret operations without terminal output. Configure ORIGIN_URL from the dedicated current tunnel. Native owner launcher reads the same origin secret and uses separate pilot stores.
4. Run `npx wrangler deploy --dry-run --outdir local-test-results/build` inside pilot for a local bundle check. Deployment, public receiving tests and real local model acceptance are owner responsibilities. Neither tests nor dry-run perform employer/provider writes or paid model calls.
5. Stop the dedicated pilot host/tunnel or disable invite rows to revoke access; revoke D1 sessions to invalidate an individual cookie immediately. Rotate shared secrets only with coordinated native/Worker configuration. Orphaned seed locks require stopping writers before owner recovery, never age-based removal.

The provisioned owner's normal restart/redeployment command is `npm run pilot:share`
from the repository root. It checks the existing Ollama service and installed
`qwen3-vl:8b-instruct` weights, reuses a healthy protected origin/tunnel or launches
dedicated hidden Node/tunnel processes, applies migrations and redeploys the stable
Worker URL. It refuses an unrelated listener on port 3102. It never changes Ollama
configuration, pulls weights, enables a paid fallback, or regenerates invites.
Keep the PC, existing model service and dedicated tunnel running throughout testing.
`npm run test:pilot:hosted` uses a real invite and consumes a daily generation
attempt; it is an owner-run acceptance check, not a CI mock or an unlimited load test.

## API contract

`GET /api/pilot/session`: authenticated, consent, aiEnabled, consentVersion (`2026-10-01-v1`).
`POST /api/pilot/login`: `{code}`. `POST /api/pilot/logout`.
`POST /api/pilot/consent`: `{consent:true,version:"2026-10-01-v1"}`.
`DELETE /api/pilot/data`: own withdrawal/deletion only.
`POST /api/pilot/events`: `{event,sessionId,details?}`. Names: upload_completed, upload_failed, session_started, demo_opened, generation_started, generation_completed, generation_failed, generation_cancelled, job_saved, job_imported, resume_edited, export_downloaded, print_opened. Details: durationMs integer 0–300000; score 0–100; count 0–10000; device mobile/desktop; format docx/print; reason network/timeout/validation/cancelled/provider/storage/unknown. Extra fields rejected.
`POST /api/pilot/feedback`: rating integer 1–5, accuracy accurate/minor_issues/major_issues/not_tested, goal tailor_resume/cover_letter/job_import/tracking/other, outcome not_applied/applied/interview/offer/not_tested, comment string ≤2000, reviewed:true. Extra fields rejected.
Owner POST `/api/pilot/admin/login` `{secret}`, GET `/api/pilot/admin/export?offset=0`, POST `/api/pilot/admin/logout`.

## Receiving evidence

`evidence/2026-10-01/native-worker-acceptance.txt` records 15/15 passing Node acceptance tests on Windows: actual current workerd executes the shipped Worker, actual local D1 persists receiving changes, and disposable HTTP origin observes stripped credentials and trusted pseudonym. Concurrent generation admissions forward exactly two requests for tester A plus one for B under a three-global cap. Tenant withdrawal, bounded pagination, retention and signed-cookie revocation are checked against receiving D1 rows. The owner dashboard test executes its actual script against receiving D1 export in jsdom and verifies a stored HTML-looking comment remains text. Native seed subprocess checks pre-write ACL enforcement, hash-only SQL and overwrite refusal. Parent performs public browser/owner readback separately.

Wrangler 4.145.0 currently uses Miniflare 5.20260930.0-alpha. The acceptance harness explicitly uses the SDK's `convertV4MiniflareOptions` compatibility adapter; older Miniflare 4 could not execute the 2026-10-01 compatibility date. `npm audit` reported zero vulnerabilities for the final pilot dependencies. Do not substitute a stale runtime to get a green date check.
