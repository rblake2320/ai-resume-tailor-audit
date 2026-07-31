# Google email and calendar connection

Resume Foundry implements the server-side OAuth 2.0 authorization-code flow with PKCE and a ten-minute, authenticated state transaction. OAuth client credentials and token material are never returned to browser JavaScript. The stored connection is AES-256-GCM sealed with `RESUME_FOUNDRY_CONNECTION_KEY` in an HttpOnly, SameSite cookie.

The user chooses features incrementally:

- `email_alerts`: Gmail read-only, for alert ingestion.
- `email_drafts`: Gmail compose, for drafts only—this does not grant direct send permission.
- `calendar_events`: Calendar events owned by the user, rather than access to every calendar setting.

Configure the variables in `.env.example`, register the exact callback URI with Google, then open `/api/connections/google/start?features=email_alerts`, adding comma-separated features only when requested. `/api/connections/google/status` reports connectivity and scopes but never returns tokens. A same-origin `POST /api/connections/google/disconnect` removes stored connection state; Origin-less and cross-origin form posts are rejected. When TLS terminates at a reverse proxy, set `RESUME_FOUNDRY_PUBLIC_ORIGIN` to the exact browser-visible origin rather than trusting caller-controlled forwarded headers.

This is a single-browser controlled-demo custody model. A public multi-user deployment must move encrypted refresh tokens into authenticated, tenant-isolated server storage, add provider revocation on disconnect, and complete Google's verification requirements. It must not claim those controls from this local composition.

Primary references:

- Google OAuth web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Google OAuth security practices: https://developers.google.com/identity/protocols/oauth2/resources/best-practices
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Calendar scopes: https://developers.google.com/workspace/calendar/api/auth
