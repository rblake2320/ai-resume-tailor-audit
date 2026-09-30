import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const reserve = createServer();
await new Promise((resolve, reject) => { reserve.once("error", reject); reserve.listen(0, "127.0.0.1", resolve); });
const address = reserve.address();
if (!address || typeof address === "string") throw new Error("Could not allocate loopback port.");
const port = address.port;
await new Promise((resolve) => reserve.close(resolve));
const env = { ...process.env,
  RESUME_FOUNDRY_RATE_LIMIT_DIR: mkdtempSync(path.join(tmpdir(), "resume-browser-")),
  RESUME_FOUNDRY_WINDOWS_ACL_MODE: "apply",
};
const prestart = spawnSync(process.execPath, ["scripts/check-windows-sensitive-paths.mjs"], { env, stdio: "inherit" });
if (prestart.status !== 0) throw new Error("Production storage preflight failed.");
// Launch the actual next start entrypoint directly so Windows cleanup owns the
// server process instead of leaving a grandchild holding native module files.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "inherit", "inherit"] });
let spawnError;
server.once("error", (error) => { spawnError = error; });
const stop = () => { if (server.exitCode === null) server.kill(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error("Production server exited before becoming ready.");
    try { ready = (await fetch(`${url}/api/capabilities`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Probe until the bounded startup deadline. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("Production browser server startup timed out.");
  const test = spawnSync("python", ["scripts/browser-acceptance.py", "--url", url, "--output", ".resume-foundry/browser"], { env, stdio: "inherit", timeout: 120_000 });
  if (test.error) throw test.error;
  process.exitCode = test.status ?? 1;
} finally {
  stop();
  if (server.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
