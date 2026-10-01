# Resume Foundry wiring audit — September 30, 2026 (America/Chicago)

Verdict: useful tested components, with incomplete product integration. The
earlier enhancement checks are not an assertion that every advertised workflow
is connected or that this product covers every market pain point.

## Executed outcomes

The production-browser acceptance now exercises thirteen scenarios. The retained
JSON identifies synthetic generation explicitly; the local server, browser
storage, encryption, packet checksums and state transitions are actual code.

- Worked: 240/390/1280px layout, private URL refusal, capabilities and Google status.
- Worked: malformed result refusal; complete synthetic result without a newline;
  document tabs, manual editing and print content.
- Worked: save a job, reject its duplicate, prepare a packet, mark it submitted,
  approve its local reminder, record a recruiter response and open interview prep.
- Worked: missing destination disables guided handoff.
- Worked: append a career event, download encrypted backup, refuse a wrong
  passphrase, restore the backup and retain application state after reload.
- Worked: no uncaught browser errors in these scenarios.

The first expanded harness run expected reminder status `approved`; the actual
contract is `scheduled`. Correcting that assertion produced a successful rerun.
Submission state is owner-entered bookkeeping. No employer received a submission;
reminder approval changes local state, without sending a notification.

## Receiving-side inventory

| Path | Actual behavior | Remaining condition |
| --- | --- | --- |
| Browser → tailor route → Anthropic | Browser parser and server provider-contract checks pass | Blocked: app-specific API key absent; live output acceptance requires provisioning it |
| Job Inbox → selected job → tailor form | Browser-local snapshots and selection | Public connector provider outcomes remain separate from synthetic route tests |
| Tailored result → application packet → tracker | Actual local checksums, transitions, persistence and interview prep tested | Owner-entered submission state is not an employer receipt |
| Tracker → reminders | Local suggested/scheduled state | No background delivery or Google calendar receiving action |
| Career Ledger → encrypted backup → recovery | Actual browser encryption and recovery tested | `createDisclosurePacket` and `reviewInferredSkill` have no app/components consumers; vault evidence is not wired into tailoring |
| Google UI → OAuth setup/status/disconnect | Connection-management routes exist | Gmail reading and calendar actions have no receiving implementation; granting their scopes does not enable a workflow |
| Google → Gmail draft | Approved submission API can create a draft | No browser draft action; live acceptance blocked by OAuth configuration/authorization |
| Browser tracker ↔ HTTP/MCP agent service | Different stores and application representations | No synchronization call from the browser tracker to agent service |
| Browser → guided handoff | Reviewed documents and an official-page opener | Human performs the external submission |
| Submission preview/approval/execute APIs | Independent authenticated and approval-bound connector path | Browser handoff does not call these APIs; employer credentials and an approved test destination are required for live acceptance |
| Laya | Optional offline CLI, 10/12 public-excerpt benchmark | Advisory requirement classification; not browser-integrated or a factuality authority |

Evidence pointers: `components/ApplicationTracker.tsx`,
`components/GuidedHandoff.tsx`, `components/Connections.tsx`,
`components/CareerLedger.tsx`, `lib/agent-service.ts`,
`app/api/submissions/execute/route.ts`, `lib/google-oauth.ts`,
`scripts/browser-acceptance.py`, and the dated evidence JSON.
Unused library functions and missing receiving routes are source-inspection
findings, not failed runtime tests. Credentials are not copied from other apps.

## Market comparison

Primary vendor pages checked September 30, 2026:

- [Teal](https://www.tealhq.com/) offers tailoring, job tracking, keyword matching,
  cover letters and interview practice.
- [Huntr](https://huntr.co/product/resume-tailor) offers job-specific tailoring
  and matching within a broader job-search product.
- [Jobscan](https://www.jobscan.co/resume-scanner) offers résumé scanning and
  job-description comparisons.

Those features cannot be called unique differentiators here. Encrypted portable
career evidence, immutable application packets, explicit disclosure approvals
and honest evidence/gap reporting are promising product choices. Public feature
pages neither establish competitor absence nor establish better hiring outcomes.
No controlled user study or comparative outcome benchmark has been executed.

## Completion priorities

1. Make displayed connection permissions reflect executable workflows; finish
   email/calendar receiving actions before presenting them as functional features.
2. Connect approved selected vault evidence to tailoring, with visible provenance
   and a browser test proving only approved entries leave the vault.
3. Choose and implement an explicit browser/agent synchronization contract, rather
   than silently treating separate stores as one application history.
4. Provision app-specific credentials and synthetic authorized provider accounts
   for live generation, OAuth and connector acceptance.
5. Validate practical user outcomes against current competitors with a finite
   benchmark before claiming market superiority or comprehensive pain-point coverage.
