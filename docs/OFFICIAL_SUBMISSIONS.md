# Official submission connectors

Direct submission is disabled unless three independent gates all pass:

1. The applicant reviews the exact destination, packet versions, answers, and personal-data categories and obtains a ten-minute HMAC-bound approval receipt.
2. The deployment explicitly allowlists the exact provider account in `RESUME_FOUNDRY_AUTHORIZED_SUBMISSION_PROVIDERS`.
3. The deployment secret manager injects the corresponding employer-side API credential. Credentials are read only by server routes and never included in a client response or committed file.

Approval receipts are exact-preview-bound, expire after ten minutes, and are durably consumed before network transmission. A consumed approval cannot be replayed; after an uncertain provider failure the user must review and approve again rather than risk a duplicate application.

Greenhouse retrieves the live job-specific question schema and validates every required field before submission because Greenhouse explicitly warns that its submission endpoint may not reject missing required fields. Lever requires an employer administrator to supply both the API key and customized required-field list. Rate-limited provider responses retry within a finite budget. Gmail creates a draft using `gmail.compose`; it does not silently send it.

Public documentation:

- Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html
- Lever Postings API: https://github.com/lever/postings-api
- Gmail drafts: https://developers.google.com/workspace/gmail/api/guides/drafts

This reference implementation proves the gates and provider request contracts with mocked transports. No real employer credential is bundled, and no test submits an application to a real employer.
