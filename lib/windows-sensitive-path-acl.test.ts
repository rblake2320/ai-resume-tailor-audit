import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
const execFileAsync = promisify(execFile);

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
      enforceConfiguredWindowsSensitivePathAcls({ env: {}, platform: "win32", runner }),
    ).resolves.toEqual({ status: "not-configured", checked: [] });
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not claim that NTFS ACLs protect non-Windows deployments", async () => {
    const runner = vi.fn<WindowsAclRunner>();
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({
        env: { RESUME_FOUNDRY_AGENT_STORE: "/private/store.json" },
        platform: "linux",
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
        env: { NODE_ENV: "development", RESUME_FOUNDRY_AGENT_STORE: "C:\\private\\agent.json" },
        platform: "win32",
      }),
    ).resolves.toEqual({ status: "skipped", checked: [] });
  });

  it("fails closed when NODE_ENV is unset and ACL enforcement is off", async () => {
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({
        env: {
          RESUME_FOUNDRY_WINDOWS_ACL_MODE: "off",
          RESUME_FOUNDRY_AGENT_STORE: "C:\\private\\agent.json",
        },
        platform: "win32",
      }),
    ).rejects.toThrow(/apply or verify is required/);
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
      RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR: path.join(root, "attempts"),
      RESUME_FOUNDRY_NONCE_STORE: path.join(root, "nonces"),
    };
    await expect(
      enforceConfiguredWindowsSensitivePathAcls({ env, platform: "win32", runner, pathApi: path }),
    ).resolves.toEqual({
      status: "secured",
      checked: [
        "RESUME_FOUNDRY_AGENT_STORE",
        "RESUME_FOUNDRY_NONCE_STORE",
        "RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR",
        "RESUME_FOUNDRY_SUBMISSION_LEDGER",
      ],
    });
    expect(runner).toHaveBeenCalledTimes(6);
    expect(runner).toHaveBeenCalledWith({
      targetPath: path.join(root, "private"),
      mode: "preflight",
      kind: "directory",
    });
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
      runner,
      pathApi: path,
    });
    expect(runner).toHaveBeenNthCalledWith(1, {
      targetPath: root,
      mode: "preflight",
      kind: "directory",
    });
    expect(runner).toHaveBeenNthCalledWith(2, { targetPath: root, mode: "verify", kind: "directory" });
    expect(runner).toHaveBeenNthCalledWith(3, { targetPath: store, mode: "verify", kind: "file" });
  });

  it("fails closed when verification reports an unexpected principal", async () => {
    const root = await tempRoot();
    const runner = vi
      .fn<WindowsAclRunner>()
      .mockResolvedValueOnce(secureResult)
      .mockResolvedValueOnce({
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
        runner,
        pathApi: path,
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

  it.runIf(process.platform === "win32")(
    "rejects a configured directory reached through a junction",
    async () => {
      const root = await tempRoot();
      const target = path.join(root, "actual");
      const junction = path.join(root, "junction");
      await mkdir(target);
      await symlink(target, junction, "junction");
      await expect(
        enforceConfiguredWindowsSensitivePathAcls({
          env: {
            NODE_ENV: "production",
            RESUME_FOUNDRY_WINDOWS_ACL_MODE: "verify",
            RESUME_FOUNDRY_NONCE_STORE: junction,
          },
          platform: "win32",
        }),
      ).rejects.toThrow(/reparse/i);
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects a junction in an ancestor and a reparse point inside a configured tree",
    async () => {
      const root = await tempRoot();
      const target = path.join(root, "actual");
      const nested = path.join(target, "nested");
      const junction = path.join(root, "junction");
      await mkdir(nested, { recursive: true });
      await symlink(target, junction, "junction");
      await expect(
        runWindowsAclScript({
          targetPath: path.join(junction, "nested"),
          mode: "verify",
          kind: "directory",
        }),
      ).rejects.toThrow(/reparse/i);

      const cleanTree = path.join(root, "clean-tree");
      const outside = path.join(root, "outside");
      await mkdir(cleanTree);
      await mkdir(outside);
      await symlink(outside, path.join(cleanTree, "child-link"), "junction");
      await expect(
        runWindowsAclScript({ targetPath: cleanTree, mode: "apply", kind: "directory" }),
      ).rejects.toThrow(/reparse/i);
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects a missing directory below a junction before creating anything through it",
    async () => {
      const root = await tempRoot();
      const target = path.join(root, "actual");
      const junction = path.join(root, "junction");
      const createdThroughJunction = path.join(target, "must-not-exist");
      await mkdir(target);
      await symlink(target, junction, "junction");
      await expect(
        enforceConfiguredWindowsSensitivePathAcls({
          env: {
            RESUME_FOUNDRY_WINDOWS_ACL_MODE: "apply",
            RESUME_FOUNDRY_NONCE_STORE: path.join(junction, "must-not-exist"),
          },
          platform: "win32",
        }),
      ).rejects.toThrow(/reparse/i);
      await expect(stat(createdThroughJunction)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.runIf(process.platform === "win32")(
    "detects and repairs a permissive ACL on an existing child",
    async () => {
      const root = await tempRoot();
      const child = path.join(root, "marker.used");
      await writeFile(child, "used");
      await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
      await execFileAsync("icacls.exe", [child, "/grant", "*S-1-5-32-545:F"]);
      await expect(
        runWindowsAclScript({ targetPath: root, mode: "verify", kind: "directory" }),
      ).rejects.toThrow();
      await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
      await expect(
        runWindowsAclScript({ targetPath: root, mode: "verify", kind: "directory" }),
      ).resolves.toMatchObject({ secure: true });
    },
  );

  it.runIf(process.platform === "win32")(
    "does not report secure when the owner has an explicit deny rule",
    async () => {
      const root = await tempRoot();
      await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
      const child = path.join(root, "denied.json");
      await writeFile(child, "{}");
      const identity = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
      await execFileAsync("icacls.exe", [child, "/deny", `${identity}:(W)`]);
      await expect(
        runWindowsAclScript({ targetPath: root, mode: "verify", kind: "directory" }),
      ).rejects.toThrow();
      await execFileAsync("icacls.exe", [child, "/remove:d", identity]);
      await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
    },
  );

  it.runIf(process.platform === "win32")(
    "does not count an inherit-only administrator ACE as effective full control",
    async () => {
      const root = await tempRoot();
      await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
      await execFileAsync("icacls.exe", [root, "/remove:g", "*S-1-5-32-544"]);
      await execFileAsync("icacls.exe", [root, "/grant", "*S-1-5-32-544:(OI)(CI)(IO)F"]);
      await expect(
        runWindowsAclScript({ targetPath: root, mode: "verify", kind: "directory" }),
      ).rejects.toThrow();
      await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
    },
  );

  it.runIf(process.platform === "win32")(
    "requires Local System as well as owner and Administrators to have full control",
    async () => {
      const root = await tempRoot();
      await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
      await execFileAsync("icacls.exe", [root, "/remove:g", "*S-1-5-18"]);
      await expect(
        runWindowsAclScript({ targetPath: root, mode: "verify", kind: "directory" }),
      ).rejects.toThrow();
      await runWindowsAclScript({ targetPath: root, mode: "apply", kind: "directory" });
    },
  );
});
