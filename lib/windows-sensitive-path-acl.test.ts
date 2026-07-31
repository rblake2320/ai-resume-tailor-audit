import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enforceConfiguredWindowsSensitivePathAcls,
  runWindowsAclScript,
  type WindowsAclRunner,
} from "./windows-sensitive-path-acl";

const secureResult = {
  secure: true,
  ownerSid: "S-1-5-21-test",
  inheritanceProtected: true,
  unexpectedAllowSids: [],
  currentUserHasFullControl: true,
};

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rf-acl-test-"));
  roots.push(root);
  return root;
}

describe("Windows sensitive-path ACL startup boundary", () => {
  it("does nothing when no sensitive server-side store is configured", async () => {
    const runner = vi.fn<WindowsAclRunner>();
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({ env: {}, platform: "win32", production: true, runner }),
    ).resolves.toEqual({ status: "not-configured", checked: [] });
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not claim that NTFS ACLs protect non-Windows deployments", async () => {
    const runner = vi.fn<WindowsAclRunner>();
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({
        env: { RESUME_FOUNDRY_AGENT_STORE: "/private/store.json" },
        platform: "linux",
        production: true,
        runner,
      }),
    ).resolves.toEqual({ status: "not-applicable", checked: [] });
    expect(runner).not.toHaveBeenCalled();
  });

  it("fails closed in Windows production until apply or verify is explicitly selected", async () => {
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({
        env: { NODE_ENV: "production", RESUME_FOUNDRY_AGENT_STORE: "C:\\private\\agent.json" },
        platform: "win32",
      }),
    ).rejects.toThrow(/RESUME_FOUNDRY_WINDOWS_ACL_MODE=apply or verify is required/);
  });

  it("allows development to opt out without making a security claim", async () => {
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({
        env: { RESUME_FOUNDRY_AGENT_STORE: "C:\\private\\agent.json" },
        platform: "win32",
        production: false,
      }),
    ).resolves.toEqual({ status: "skipped", checked: [] });
  });

  it("rejects relative paths and filesystem-root parent directories", async () => {
    const runner = vi.fn<WindowsAclRunner>();
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({
        env: {
          RESUME_FOUNDRY_WINDOWS_ACL_MODE: "verify",
          RESUME_FOUNDRY_AGENT_STORE: "relative\\agent.json",
        },
        platform: "win32",
        runner,
      }),
    ).rejects.toThrow(/absolute Windows path/);
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({
        env: {
          RESUME_FOUNDRY_WINDOWS_ACL_MODE: "verify",
          RESUME_FOUNDRY_AGENT_STORE: "C:\\agent.json",
        },
        platform: "win32",
        runner,
      }),
    ).rejects.toThrow(/filesystem-root parent/);
  });

  it("deduplicates shared directories and applies before verifying the result", async () => {
    const root = await tempRoot();
    const runner = vi.fn<WindowsAclRunner>().mockResolvedValue(secureResult);
    const env = {
      RESUME_FOUNDRY_WINDOWS_ACL_MODE: "apply",
      RESUME_FOUNDRY_AGENT_STORE: path.join(root, "private", "agent.json"),
      RESUME_FOUNDRY_SUBMISSION_LEDGER: path.join(root, "private", "submissions.jsonl"),
      RESUME_FOUNDRY_NONCE_STORE: path.join(root, "nonces"),
    };
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({ env, platform: "win32", production: true, runner }),
    ).resolves.toEqual({
      status: "secured",
      checked: [
        "RESUME_FOUNDRY_AGENT_STORE",
        "RESUME_FOUNDRY_NONCE_STORE",
        "RESUME_FOUNDRY_SUBMISSION_LEDGER",
      ],
    });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenCalledWith({
      targetPath: path.join(root, "private"),
      mode: "apply",
      kind: "directory",
    });
    expect(runner).toHaveBeenCalledWith({
      targetPath: path.join(root, "nonces"),
      mode: "apply",
      kind: "directory",
    });
  });

  it("checks an existing sensitive file as well as its containing directory", async () => {
    const root = await tempRoot();
    const store = path.join(root, "agent.json");
    await writeFile(store, "{}");
    const runner = vi.fn<WindowsAclRunner>().mockResolvedValue(secureResult);
    await enforceConfiguredWindowsSensitivePathAcls({
      env: {
        RESUME_FOUNDRY_WINDOWS_ACL_MODE: "verify",
        RESUME_FOUNDRY_AGENT_STORE: store,
      },
      platform: "win32",
      production: true,
      runner,
    });
    expect(runner).toHaveBeenNthCalledWith(1, { targetPath: root, mode: "verify", kind: "directory" });
    expect(runner).toHaveBeenNthCalledWith(2, { targetPath: store, mode: "verify", kind: "file" });
  });

  it("fails closed when verification reports an unexpected principal", async () => {
    const root = await tempRoot();
    const runner = vi.fn<WindowsAclRunner>().mockResolvedValue({
      ...secureResult,
      secure: false,
      unexpectedAllowSids: ["S-1-5-32-545"],
    });
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({
        env: {
          RESUME_FOUNDRY_WINDOWS_ACL_MODE: "verify",
          RESUME_FOUNDRY_RATE_LIMIT_DIR: root,
        },
        platform: "win32",
        production: true,
        runner,
      }),
    ).rejects.toThrow(/unexpectedAllowCount=1/);
  });

  it.runIf(process.platform === "win32")(
    "applies and independently verifies an ACL only inside a disposable temporary directory",
    async () => {
      const root = await tempRoot();
      const applied = await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
      expect(applied).toMatchObject({
        secure: true,
        inheritanceProtected: true,
        unexpectedAllowSids: [],
        currentUserHasFullControl: true,
      });
      const file = path.join(root, "existing.json");
      await writeFile(file, "{}");
      await expect(
        runWindowsAclScript({ targetPath: root, mode: "verify", kind: "directory" }),
      ).resolves.toMatchObject({
        secure: true,
      });
      await expect(
        runWindowsAclScript({ targetPath: file, mode: "apply", kind: "file" }),
      ).resolves.toMatchObject({ secure: true });
    },
  );
});
