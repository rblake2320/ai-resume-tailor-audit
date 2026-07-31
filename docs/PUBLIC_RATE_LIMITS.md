# Public endpoint rate limits

Resume Foundry bounds the unauthenticated work performed by its four browser-facing mutation endpoints. The defaults are fixed windows:

| Scope | Default |
|---|---:|
| `tailor` | 10 requests/minute |
| `fetch-job` | 60 requests/minute |
| `jobs-import` | 60 requests/minute |
| `parse-resume` | 30 requests/minute |

Production requires an absolute `RESUME_FOUNDRY_RATE_LIMIT_DIR` on a private durable local volume shared by every Node worker. Admission uses atomic exclusive-create slot files, so separate OS processes cannot spend the same slot. Missing, unwritable, or invalid production configuration fails closed with `503 RATE_LIMIT_UNAVAILABLE`; exhausted capacity returns `429 RATE_LIMITED` and `Retry-After`.

Override a scope with `RESUME_FOUNDRY_<SCOPE>_LIMIT` and `RESUME_FOUNDRY_<SCOPE>_WINDOW_MS`, replacing punctuation with underscores (for example `RESUME_FOUNDRY_FETCH_JOB_LIMIT`). Values must be plain positive base-10 integers: capacity is capped at 1,000 and the window at one day to bound filesystem work and configuration mistakes. Invalid configuration fails closed.

This is a global, single-host overload/spend control. It is not user identity, tenant fairness, abuse attribution, or a multi-host/distributed limit. The configured directory and host clock are trusted deployment inputs; POSIX mode hints do not enforce Windows ACLs. Public multi-user deployment still requires authenticated tenants and a shared production limiter at the gateway or durable service layer.
