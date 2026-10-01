# Google receiving workflow acceptance

**TRAINING_OR_ENGINEERING_USE_ONLY**

Implemented explicit alert retrieval, reviewed local Job Inbox import, reviewed private Calendar events with popup reminders, and reviewed unsent Gmail drafts. Provider calls use fixed official destinations, bounded native transport, validated sealed connection state and server-only token refresh. Writes require a separate five-minute authenticated review, connection binding, explicit approval and durable single-use nonce claim; failed outcome verification never reissues a write automatically.

**Worked:** 19/19 targeted tests across four suites. Evidence: `google-workflows-tests.txt`.

- Provider fixtures verify supported scopes, token refresh, read count, selected message identity, plain-text MIME traversal, malformed/hostile inputs, private event reminders and independent event/draft read-back.
- Route tests verify origin rejection, exact request fields, 8 KiB bounds, missing review, missing replay store, connection binding, nonce replay rejection, no secret-bearing response and no-store response policy.
- React browser tests verify no Gmail read before an explicit click; actual localStorage Job Inbox writes; the visible Job Inbox receiving update; duplicate import denial; separate review and approval clicks; and the verified unsent draft receipt display.
- A real local HTTP fixture receives and stores reviewed event and draft POSTs, then independently serves their GET results and an alert. The same provider functions use native fetch/sockets through an injected destination mapper. Six actual requests were asserted: two creates, two receiving read-backs and two alert reads. No send endpoint is called.

Google OAuth configuration and an account consent were not available in the isolated review environment. No live email was read, sent or drafted, and no real Calendar event was created. Live receiving acceptance requires owner configuration and consent; event/draft writes remain subject to the explicit product review/approval controls. Existing Google compose scope permits sending at the provider, so documentation now accurately distinguishes that privilege from the application's draft-only exposed operation.

Primary API contracts were checked against Google's current documentation: [draft creation](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create), [message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), and [Calendar event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

Changed receiving UI: `components/Connections.tsx` and the cleaned-up `resume-foundry:jobs-imported` listener in `components/JobInbox.tsx`. Changed API: `app/api/connections/google/actions/route.ts`; disconnect also deletes its pending review cookie. Implementation: `lib/google-workflows.ts`; deployment/user explanation: `docs/GOOGLE_CONNECTIONS.md`.
