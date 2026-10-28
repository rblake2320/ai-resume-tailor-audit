import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { enforceConfiguredWindowsSensitivePathAcls } from "../lib/windows-sensitive-path-acl.ts";
import { withFileLock } from "../lib/file-lock.ts";

// An owned loopback workshop; provider keys remain in ignored .env.local.
const args = process.argv.slice(2);
const pilot = args.includes("--pilot");
const portIndex = args.indexOf("--port");
const port = portIndex === -1 ? 3100 : Number(args[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a local port from 1024 through 65535.");
if (!existsSync(".next/BUILD_ID")) throw new Error("Build first with npm run build.");
const root = path.resolve(".resume-foundry", pilot ? "pilot-runtime" : "local-runtime");
const env = { ...process.env,
  RESUME_FOUNDRY_RATE_LIMIT_DIR: path.join(root, "limits"),
  RESUME_FOUNDRY_AGENT_STORE: path.join(root, "operator", "agent.json"),
  RESUME_FOUNDRY_NONCE_STORE: path.join(root, "nonces"),
  RESUME_FOUNDRY_SUBMISSION_LEDGER: path.join(root, "submissions", "used.jsonl"),
  RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR: path.join(root, "attempts"),
  RESUME_FOUNDRY_WINDOWS_ACL_MODE: "apply",
  RESUME_FOUNDRY_PUBLIC_ORIGIN: `http://localhost:${port}`,
};
if (pilot) {
  const bundlePath = path.resolve(".resume-foundry", "pilot", "operator", "owner-secrets.json");
  let bundle;
  try { bundle = JSON.parse(readFileSync(bundlePath, "utf8")); }
  catch { throw new Error("Provision the private pilot owner bundle before starting the tester origin."); }
  if (typeof bundle.ORIGIN_SECRET !== "string" || bundle.ORIGIN_SECRET.length < 32) throw new Error("Invalid pilot origin credential.");
  env.RESUME_FOUNDRY_PILOT_MODE = "true";
  env.RESUME_FOUNDRY_DOCUMENT_PARSER = "tika";
  env.RESUME_FOUNDRY_PILOT_ORIGIN_SECRET = bundle.ORIGIN_SECRET;
  env.RESUME_FOUNDRY_PILOT_AI_ENABLED = args.includes("--free-ai") ? "true" : "false";
  env.RESUME_FOUNDRY_GENERATION_PROVIDER = "ollama";
  env.RESUME_FOUNDRY_MAX_OUTPUT_TOKENS = "8192";
}
// Apply the same shipped preflight before writing reusable operator secrets.
const secured = await enforceConfiguredWindowsSensitivePathAcls({ env });
if (secured.status === "secured") console.log(`Private Windows storage checked (${secured.checked.length} paths).`);
const file = path.join(root, "operator", "local-config.json");
if (process.platform !== "win32") mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
const secrets = await withFileLock(`${file}.lock`, async () => {
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, "utf8")); }
    catch { throw new Error("Local operator configuration is unreadable. Restore the original private configuration; credentials were not replaced."); }
  }
  const generated = Object.fromEntries(["RESUME_FOUNDRY_AGENT_API_TOKEN", "RESUME_FOUNDRY_AGENT_AUDIT_KEY", "RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET", "RESUME_FOUNDRY_CONNECTION_KEY"].map((name) => [name, randomBytes(32).toString("base64url")]));
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(generated, null, 2)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file);
  return generated;
});
if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) throw new Error("Invalid local operator configuration. Restore the original private configuration.");
for (const [name, value] of Object.entries(secrets)) {
  if (!["RESUME_FOUNDRY_AGENT_API_TOKEN", "RESUME_FOUNDRY_AGENT_AUDIT_KEY", "RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET", "RESUME_FOUNDRY_CONNECTION_KEY"].includes(name) || typeof value !== "string" || value.length < 32) throw new Error("Invalid local operator configuration. Restore the original private configuration.");
  env[name] = value;
}
for (const name of ["RESUME_FOUNDRY_AGENT_API_TOKEN", "RESUME_FOUNDRY_AGENT_AUDIT_KEY", "RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET", "RESUME_FOUNDRY_CONNECTION_KEY"]) if (!secrets[name]) throw new Error("Local operator configuration is incomplete.");
console.log(`${pilot ? "Private tester origin (gateway required)" : "Workshop"}: http://localhost:${port}`);
console.log(`Session credentials for the optional agent bridge are in ${file}; values are never logged.`);
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "inherit" });
server.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.once("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.kill());
