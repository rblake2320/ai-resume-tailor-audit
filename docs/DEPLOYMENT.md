# Deployment runbook

Resume Foundry intentionally fails closed when a feature needs durable security state and its deployment has not supplied it. A local development server and a production server do not have the same minimum environment. Start with the smallest profile below and add a capability only when its entire row is configured.

Never commit `.env.local` or `.env.production.local`. Both are ignored by Git. In a hosted deployment, inject secrets from the platform secret manager and mount durable private paths separately from the application checkout.

## Environment profiles

| Capability | Required configuration | What happens when it is absent |
|---|---|---|
| Local UI without generation | none (`npm run dev`) | The workshop loads; generation cannot call Anthropic. |
| Tailoring | `ANTHROPIC_API_KEY` | The generation request fails without spending provider quota. |
| Production public endpoints | absolute, durable `RESUME_FOUNDRY_RATE_LIMIT_DIR` | Protected public routes return `503 RATE_LIMIT_UNAVAILABLE`; the server can still render pages. |
| Reverse-proxied Google connection controls | exact browser-visible `RESUME_FOUNDRY_PUBLIC_ORIGIN` | Same-origin disconnect validation may reject a legitimate request behind a proxy. Use `http://localhost:3000` for the documented local profile. |
| Agent HTTP API | `RESUME_FOUNDRY_AGENT_API_TOKEN`, 32+ byte `RESUME_FOUNDRY_AGENT_AUDIT_KEY`, absolute `RESUME_FOUNDRY_AGENT_STORE` | Agent calls fail closed; the browser workshop remains separate. |
| MCP stdio | the agent-store settings above plus `RESUME_FOUNDRY_MCP_ENABLED=true` | `npm run mcp` refuses to expose tools. The web server does not require MCP to be enabled. |
| Employer/Gmail submission | `RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET`, absolute `RESUME_FOUNDRY_SUBMISSION_LEDGER`, absolute `RESUME_FOUNDRY_NONCE_STORE`, absolute `RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR`, an exact provider allowlist, and that provider's credential | Approval or execution fails before provider transport. |
| Windows production with any sensitive path above | `RESUME_FOUNDRY_WINDOWS_ACL_MODE=apply` or `verify` | `npm start` exits during `prestart` instead of serving with a permissive NTFS ACL. |

`RESUME_FOUNDRY_MCP_ENABLED=false` is a useful explicit default, not a requirement for the web server. `RESUME_FOUNDRY_PUBLIC_ORIGIN` is a correctness requirement for the connection mutation behind a TLS-terminating proxy, not authentication for the rest of the application.

## Minimal local production profile

Use a private directory outside the repository. This example enables the browser workshop and real tailoring but does not enable agents, MCP, Google, or employer submission.

```dotenv
ANTHROPIC_API_KEY=<from your secret manager>
RESUME_FOUNDRY_PUBLIC_ORIGIN=http://localhost:3000
RESUME_FOUNDRY_RATE_LIMIT_DIR=C:\Users\<service-user>\AppData\Local\ResumeFoundry\rate-limits
RESUME_FOUNDRY_WINDOWS_ACL_MODE=apply
RESUME_FOUNDRY_MCP_ENABLED=false
```

Then run:

```powershell
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm start -- --hostname 127.0.0.1 --port 3000
```

`apply` creates missing configured directories and replaces their ACLs with owner, Local System, and local Administrators access only. Use a dedicated service identity. After provisioning once, a locked-down deployment may switch to `verify`; it will refuse ACL drift rather than repairing it. Read [WINDOWS_STORAGE_ACL.md](WINDOWS_STORAGE_ACL.md) before using a shared volume, container mount, network share, or non-NTFS filesystem.

## Full single-host capability layout

Keep related state under one private durable root, but use separate files and directories. Example names—not secrets—are:

```text
ResumeFoundry\
  agent\agent-store.json
  limits\
  submissions\used-approvals.jsonl
  submissions\nonces\
  submissions\attempts\
```

Map them to:

```dotenv
RESUME_FOUNDRY_AGENT_STORE=C:\private\ResumeFoundry\agent\agent-store.json
RESUME_FOUNDRY_RATE_LIMIT_DIR=C:\private\ResumeFoundry\limits
RESUME_FOUNDRY_SUBMISSION_LEDGER=C:\private\ResumeFoundry\submissions\used-approvals.jsonl
RESUME_FOUNDRY_NONCE_STORE=C:\private\ResumeFoundry\submissions\nonces
RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR=C:\private\ResumeFoundry\submissions\attempts
```

All Node workers on the same host must use the same durable paths. These file-backed primitives provide single-host cross-process coordination; they are not a distributed multi-host datastore.

## Startup verification

1. Confirm the checkout and intended build: `git status --short --branch` and `git rev-parse HEAD`.
2. Run `npm ci`, the test/lint/typecheck gates, and `npm run build`.
3. Run `npm start`. On Windows, expect `Windows sensitive-storage ACL check passed` before Next starts when sensitive paths are configured.
4. Check the page and guide routes: `/`, `/how-it-works`, and `/about` must return `200`.
5. Send a small invalid JSON object to `/api/tailor`. A normal `400` schema response proves the rate-limit store admitted the request; `503 RATE_LIMIT_UNAVAILABLE` means its directory is missing, relative, unwritable, or unsafe.
6. Verify the process binds only to the intended interface. The local profile uses `127.0.0.1`, not `0.0.0.0`.
7. Test only the optional capabilities you deliberately enabled. Do not infer provider readiness from unit tests with mocked transports.

## Failure guide

| Symptom | Meaning and action |
|---|---|
| `RESUME_FOUNDRY_WINDOWS_ACL_MODE=apply or verify is required` | A Windows sensitive path is configured without an ACL policy. Choose `apply` for provisioning or pre-provision the path and use `verify`; do not bypass it with `off` in production. |
| `RATE_LIMIT_UNAVAILABLE` / `safety limit is not ready` | Set `RESUME_FOUNDRY_RATE_LIMIT_DIR` to an absolute private durable directory shared by the host's workers, then restart. |
| `RESUME_FOUNDRY_AGENT_AUDIT_KEY must contain at least 32 bytes` | Inject a separate 32+ byte audit key. Do not reuse the API bearer token or place the value in Git. |
| `RESUME_FOUNDRY_NONCE_STORE must be configured` | Submission/attestation replay protection has no durable store. Configure its absolute shared directory before enabling that operation. |
| `RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR must be configured` | Provider attempt state cannot be made durable. Configure it; never substitute an in-memory fallback. |
| MCP refuses to start | This is expected until `RESUME_FOUNDRY_MCP_ENABLED=true`. Enable it only for a trusted local process boundary. |
| Google disconnect returns `403` behind a proxy | Set `RESUME_FOUNDRY_PUBLIC_ORIGIN` to the exact external origin, including scheme and non-default port. |

## What this runbook does not prove

Successful startup proves only that local prerequisites passed. It does not prove a real Anthropic request, OAuth exchange, email draft, employer API contract, multi-host correctness, backup recovery, monitoring, or public multi-user readiness. Capture those as separate credentialed acceptance evidence and never submit a real employment application as a deployment smoke test.
