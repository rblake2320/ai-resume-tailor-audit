# Google email and calendar connection

Resume Foundry implements the server-side OAuth 2.0 authorization-code flow with PKCE and a ten-minute, authenticated state transaction. OAuth client credentials and token material are never returned to browser JavaScript. The stored connection is AES-256-GCM sealed with `RESUME_FOUNDRY_CONNECTION_KEY` in an HttpOnly, SameSite cookie.

The user chooses features incrementally:

- `email_alerts`: Gmail read-only, for alert ingestion.
- `email_drafts`: Gmail compose. Google's scope can send mail, but this application's workflow exposes only unsent draft creation; it has no send endpoint or automatic send action.
- `calendar_events`: Calendar events owned by the user, rather than access to every calendar setting.

Configure the variables in `.env.example`, register the exact callback URI with Google, then open `/api/connections/google/start?features=email_alerts`, adding comma-separated features only when requested. `/api/connections/google/status` reports connectivity and scopes but never returns tokens. A same-origin `POST /api/connections/google/disconnect` removes stored connection state; Origin-less and cross-origin form posts are rejected. When TLS terminates at a reverse proxy, set `RESUME_FOUNDRY_PUBLIC_ORIGIN` to the exact browser-visible origin rather than trusting caller-controlled forwarded headers.

This is a single-browser controlled-demo custody model. A public multi-user deployment must move encrypted refresh tokens into authenticated, tenant-isolated server storage, add provider revocation on disconnect, and complete Google's verification requirements. It must not claim those controls from this local composition.

## Receiving workflows

The Connections panel reads Gmail only after the user clicks **Read up to 10 matching alerts**. The selected search query is sent to Gmail's list API; full-message reads retrieve only those identifiers. Plain-text MIME content is displayed as text, with byte, message-count and nesting budgets. Attachments and HTML execution are excluded. The user reviews the employer, role, application URL and message text before importing an alert into browser Job Inbox. A browser event reloads the visible inbox after persistence; duplicates are detected.

Calendar and draft creation use two separate clicks: **Review** produces an authenticated server-side review, then **Approve & create** executes the exact reviewed fields. Reviews expire in five minutes and are bound to the sealed Google connection. Execution atomically consumes a durable nonce before provider transport, so browser retries cannot replay the approval. Configure the absolute private `RESUME_FOUNDRY_NONCE_STORE` directory before enabling these write actions; reviews fail closed if it is absent. The existing Windows sensitive-storage gate covers that directory.

Events target only the account's primary calendar, use private visibility, omit attendees, disable invitation updates, and include the reviewed popup reminder. The workflow reads the event back and compares its identity, title, notes, timestamps and reminder before reporting a verified receipt. Email actions create only a plain-text draft, with header-injection checks and MIME/base64 encoding; the workflow reads the draft back and checks the reviewed recipient, subject, body and approval marker. No `/send` API is called. If read-back fails after a write, the approval remains consumed and the UI directs the user to check Google before creating another action.

Access tokens refresh server-side before a requested operation when expiration is near. Missing refresh tokens, malformed refresh results or reduced granted scopes fail closed and require reconnecting. Every provider call retains the 15-second deadline, redirect refusal and bounded body control. `/api/connections/google/actions` requires an explicit same-origin JSON POST, enforces an 8 KiB request limit and a shared 20-request/minute budget, and returns `Cache-Control: no-store`. Tokens never appear in action responses.

Synthetic receiving/provider, route and React browser acceptance evidence is retained in `docs/evidence/2026-09-30/google-workflows-tests.txt`. These fixtures do not claim a live Google account receipt. Connecting an account requires the owner's OAuth client configuration and Google consent; every external write still requires the action review and approval above.

Primary references:

- Google OAuth web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Google OAuth security practices: https://developers.google.com/identity/protocols/oauth2/resources/best-practices
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Calendar scopes: https://developers.google.com/workspace/calendar/api/auth
- Gmail message listing: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- Gmail draft creation: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
- Calendar event insertion: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
