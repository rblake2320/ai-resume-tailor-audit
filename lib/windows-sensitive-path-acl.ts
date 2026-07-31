import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const WINDOWS_ACL_MODE_ENV = "RESUME_FOUNDRY_WINDOWS_ACL_MODE";

const SENSITIVE_PATHS = [
  { env: "RESUME_FOUNDRY_AGENT_STORE", kind: "file" },
  { env: "RESUME_FOUNDRY_SUBMISSION_LEDGER", kind: "file" },
  { env: "RESUME_FOUNDRY_NONCE_STORE", kind: "directory" },
  { env: "RESUME_FOUNDRY_RATE_LIMIT_DIR", kind: "directory" },
  { env: "RESUME_FOUNDRY_AUDIT_STORE", kind: "file" },
] as const;

export type WindowsAclMode = "apply" | "verify";
export type AclEnvironment = Record<string, string | undefined>;

export interface WindowsAclRunnerResult {
  secure: boolean;
  ownerSid: string;
  inheritanceProtected: boolean;
  unexpectedAllowSids: string[];
  currentUserHasFullControl: boolean;
}

export type WindowsAclRunner = (input: {
  targetPath: string;
  mode: WindowsAclMode;
  kind: "directory" | "file";
}) => Promise<WindowsAclRunnerResult>;

export interface SensitivePathAclResult {
  status: "not-applicable" | "not-configured" | "skipped" | "secured";
  checked: string[];
}

function configuredTargets(env: AclEnvironment) {
  return SENSITIVE_PATHS.flatMap((entry) => {
    const configured = env[entry.env]?.trim();
    return configured ? [{ ...entry, configured }] : [];
  });
}

function parseMode(value: string | undefined): WindowsAclMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "off") return undefined;
  if (normalized === "apply" || normalized === "verify") return normalized;
  throw new Error(`${WINDOWS_ACL_MODE_ENV} must be apply, verify, or off.`);
}

function assertSafeAbsolutePath(configured: string, envName: string) {
  if (!path.win32.isAbsolute(configured)) {
    throw new Error(`${envName} must be an absolute Windows path before its ACL can be checked.`);
  }
  const resolved = path.win32.resolve(configured);
  if (resolved === path.win32.parse(resolved).root) {
    throw new Error(`${envName} must not target a filesystem root.`);
  }
  return resolved;
}

function uniqueDirectories(env: AclEnvironment) {
  const byCanonicalPath = new Map<string, { path: string; envNames: string[] }>();
  for (const target of configuredTargets(env)) {
    const resolved = assertSafeAbsolutePath(target.configured, target.env);
    const directory = target.kind === "file" ? path.win32.dirname(resolved) : resolved;
    if (directory === path.win32.parse(directory).root) {
      throw new Error(`${target.env} has a filesystem-root parent; use a dedicated private directory.`);
    }
    const key = directory.toLowerCase();
    const previous = byCanonicalPath.get(key);
    if (previous) previous.envNames.push(target.env);
    else byCanonicalPath.set(key, { path: directory, envNames: [target.env] });
  }
  return [...byCanonicalPath.values()];
}

export async function runWindowsAclScript(input: {
  targetPath: string;
  mode: WindowsAclMode;
  kind: "directory" | "file";
}): Promise<WindowsAclRunnerResult> {
  const script = path.join(process.cwd(), "scripts", "windows-sensitive-path-acl.ps1");
  await access(script);
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Mode",
      input.mode,
      "-TargetPath",
      input.targetPath,
      "-Kind",
      input.kind,
    ],
    { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 },
  );
  const parsed = JSON.parse(stdout.trim()) as WindowsAclRunnerResult;
  if (typeof parsed.secure !== "boolean" || !Array.isArray(parsed.unexpectedAllowSids)) {
    throw new Error("Windows ACL helper returned an invalid result.");
  }
  return parsed;
}

export async function enforceConfiguredWindowsSensitivePathAcls(options: {
  env?: AclEnvironment;
  platform?: NodeJS.Platform;
  production?: boolean;
  runner?: WindowsAclRunner;
} = {}): Promise<SensitivePathAclResult> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const production = options.production ?? env.NODE_ENV === "production";
  const targets = configuredTargets(env);

  if (targets.length === 0) return { status: "not-configured", checked: [] };
  if (platform !== "win32") return { status: "not-applicable", checked: [] };

  const mode = parseMode(env[WINDOWS_ACL_MODE_ENV]);
  if (!mode) {
    if (production) {
      throw new Error(
        `${WINDOWS_ACL_MODE_ENV}=apply or verify is required in production when sensitive Windows paths are configured.`,
      );
    }
    return { status: "skipped", checked: [] };
  }

  const runner = options.runner ?? runWindowsAclScript;
  const checked: string[] = [];
  for (const directory of uniqueDirectories(env)) {
    if (mode === "apply") await mkdir(directory.path, { recursive: true });
    else {
      const info = await stat(directory.path).catch(() => undefined);
      if (!info?.isDirectory()) {
        throw new Error(`${directory.envNames.join("/")} private directory does not exist.`);
      }
    }
    const result = await runner({ targetPath: directory.path, mode, kind: "directory" });
    if (!result.secure) {
      throw new Error(
        `${directory.envNames.join("/")} failed the Windows ACL boundary: inheritanceProtected=${result.inheritanceProtected}, currentUserFullControl=${result.currentUserHasFullControl}, unexpectedAllowCount=${result.unexpectedAllowSids.length}.`,
      );
    }
    checked.push(...directory.envNames);
  }
  for (const target of targets.filter((entry) => entry.kind === "file")) {
    const resolved = assertSafeAbsolutePath(target.configured, target.env);
    const info = await stat(resolved).catch(() => undefined);
    if (!info) continue;
    if (!info.isFile()) throw new Error(`${target.env} must identify a regular file.`);
    const result = await runner({ targetPath: resolved, mode, kind: "file" });
    if (!result.secure) {
      throw new Error(
        `${target.env} file failed the Windows ACL boundary: inheritanceProtected=${result.inheritanceProtected}, currentUserFullControl=${result.currentUserHasFullControl}, unexpectedAllowCount=${result.unexpectedAllowSids.length}.`,
      );
    }
  }
  return { status: "secured", checked: checked.sort() };
}
