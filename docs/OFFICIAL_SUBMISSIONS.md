# Official submission connectors

Direct submission is disabled unless three independent gates all pass:

1. The applicant reviews the exact destination, packet versions, answers, and personal-data categories and obtains a ten-minute HMAC-bound approval receipt.
2. The deployment explicitly allowlists the exact provider account in `RESUME_FOUNDRY_AUTHORIZED_SUBMISSION_PROVIDERS`.
3. The deployment secret manager injects the corresponding employer-side API credential. Credentials are read only by server routes and never included in a client response or committed file.

Approval receipts are exact-preview-bound, expire after ten minutes, and are durably consumed before network transmission. A consumed approval cannot be replayed. Provider-attempt state is keyed by provider, application id, and exact packet checksum and is written `pending` before network I/O. Concurrent calls for that key cannot both reach transport; an `accepted` record permanently blocks repeats.

Attempt-state commits synchronize a newly created temporary file, atomically rename it, synchronize the renamed file, and synchronize the containing directory before transport. POSIX directory-sync errors fail closed. Node on Windows does not consistently expose directory `FlushFileBuffers`; only its known `EINVAL`, `ENOTSUP`, `EISDIR`, and `EPERM` directory-handle failures use the already-synchronized final-file fallback. Every other Windows error also fails closed.

If transport fails after it may have reached the provider, the record becomes `uncertain`. Retrying requires a **new approval receipt**, issued after the failure, whose signed preview names the exact prior attempt id and includes the fixed acknowledgement that the packet may already have reached the provider. An unsigned request flag cannot authorize a retry. This reduces silent duplicates; it does **not** provide exactly-once delivery because the provider APIs expose no idempotency contract.

A process crash can leave `pending`. Pending records never expire and are never reclaimed by age. Recovery is deliberately fail-closed: stop every process that can submit, inspect the provider and attempt record, then run `npm run submission-attempt:recover -- <provider> <applicationId> <packetChecksum> --confirm-all-submitters-stopped` to mark that exact pending record `uncertain`; restart one process and require the applicant's newly signed acknowledgement. Never delete or rewrite an attempt record while a submitter may be alive. If the recovery command reports an orphaned `.lock`, keep every submitter stopped, remove only that exact sibling lock, and rerun the command; lock age alone is never evidence that its owner is dead.

Approval and execution accept JSON only and stream-read bounded request bodies
(6,000,000 and 8,000,000 bytes respectively) before parsing. Invalid declared
lengths, unsupported media types, and oversized requests fail before approval,
packet verification, nonce consumption, or provider I/O.

Greenhouse retrieves the live job-specific question schema and validates every required field before submission because Greenhouse explicitly warns that its submission endpoint may not reject missing required fields. Lever requires an employer administrator to supply both the API key and customized required-field list. Rate-limited provider responses retry within a finite budget. Gmail creates a draft using `gmail.compose`; it does not silently send it.

Public documentation:

- Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html
- Lever authenticated API, "Apply to a posting" (`POST /postings/:posting/apply` under `https://api.lever.co/v1`): https://hire.lever.co/developer/documentation (verified 2026-07-31)
- Gmail drafts: https://developers.google.com/workspace/gmail/api/guides/drafts

This reference implementation proves the gates and provider request contracts with mocked transports. No real employer credential is bundled, and no test submits an application to a real employer.
