# Windows server-side storage ACL boundary

Resume Foundry stores résumé packets, submission receipts, nonce markers, rate-limit slots, and audit records on the server when those capabilities are enabled. `mode: 0o600` is a POSIX creation hint; Node does not turn it into an owner-only NTFS ACL on Windows.

On Windows, `npm start` checks every configured sensitive path in its `prestart` gate. `instrumentation.ts` repeats the boundary during Next.js runtime initialization so an alternate launcher cannot serve a protected route without passing it. Set:

```text
RESUME_FOUNDRY_WINDOWS_ACL_MODE=apply
```

for a service account that is allowed to create and secure its dedicated directories, or use `verify` when directories are provisioned separately. When any sensitive path is configured, the mode is mandatory unless `NODE_ENV` is explicitly `development` or `test`; an unset or misspelled environment is treated as production-sensitive and fails closed. If the mode is missing, `off`, invalid, or verification fails, `npm start` exits before launching Next.js. The instrumentation backstop rejects runtime initialization.

The boundary recognizes these paths:

- `RESUME_FOUNDRY_AGENT_STORE` (file; its containing directory is secured)
- `RESUME_FOUNDRY_SUBMISSION_LEDGER` (file; its containing directory is secured)
- `RESUME_FOUNDRY_NONCE_STORE` (directory)
- `RESUME_FOUNDRY_RATE_LIMIT_DIR` (directory)
- `RESUME_FOUNDRY_AUDIT_STORE` (file; its containing directory is secured)

The file stores use atomic replacement, so securing the containing directory is essential: replacement files inherit that directory's ACL. An already-existing configured file is checked and, in `apply` mode, secured separately so an old protected or explicit ACL cannot survive merely because its parent changed. Filesystem-root directories are refused. Put each deployment's sensitive files below a dedicated directory.

## What `apply` does

The PowerShell helper uses .NET's supported `System.Security.AccessControl` APIs with literal paths. Node launches the checked-in script with `execFile` and an argument array; configured paths are never concatenated into a shell command. The helper:

1. disables inherited access rules;
2. sets the service identity as owner;
3. replaces access rules with full control for the service identity, Local System, and the local Administrators group;
4. reads the resulting ACL back; and
5. fails unless inheritance is disabled, the service identity owns the directory and has full control, and no other principal has an allow rule.

Before `apply` creates a missing directory, a separate component-by-component preflight rejects reparse points in every existing ancestor, so creation cannot be redirected through a junction. Existing directory trees are then walked without following reparse points. Every existing child is verified and `apply` replaces its ACL; a junction, symbolic link, mount point, or other reparse point in the configured path or tree fails the check. Deny rules fail verification, inherit-only rules are not counted as effective access, and the service identity, Local System, and Administrators must each retain effective full control.

`verify` performs only steps 4 and 5.

## Security boundary and limits

- This blocks access by other ordinary local users. It cannot stop Local System or an administrator, who are deliberately retained and can take ownership on Windows regardless.
- It does not encrypt data at rest, protect a compromised service identity, secure backups, or replace disk encryption.
- ACL safety depends on a trusted local filesystem. Container bind mounts, SMB shares, non-NTFS filesystems, orchestrator-mounted secrets, and volume drivers may have different permission semantics and must be validated by that deployment.
- A parent administrator can change ACLs after startup. Production monitoring should periodically run verification and alert on drift.
- On Linux/macOS this Windows check reports `not-applicable`; deployment-specific POSIX ownership/mode checks remain required. No cross-platform owner-only claim is made.
- Paths and the checked-in PowerShell helper must ship together. Missing helper files fail the prestart/runtime check when checking is required.
- Launchers that bypass `npm start` should run `node --experimental-strip-types scripts/check-windows-sensitive-paths.mjs` before starting the process. The instrumentation hook is defense in depth, not a substitute for an orchestrator that treats a failed preflight as a failed deployment.
