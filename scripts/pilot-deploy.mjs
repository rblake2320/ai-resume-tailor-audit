import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const directory = path.resolve(".resume-foundry", "pilot", "operator");
const config = JSON.parse(await readFile("pilot/wrangler.jsonc", "utf8"));
const owner = JSON.parse(await readFile(path.join(directory, "owner-secrets.json"), "utf8"));
const log = await readFile(".resume-foundry/pilot/tunnel.log", "utf8");
const origins = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gu);
const origin = origins?.at(-1);
if (!origin) throw new Error("Start the dedicated tester tunnel before deployment.");
const freeAi = process.argv.includes("--free-ai");
const health = await fetch(`${origin}/api/capabilities`, { headers: { "x-resume-pilot-origin": owner.ORIGIN_SECRET }, signal: AbortSignal.timeout(10_000) });
if (!health.ok) throw new Error("The protected pilot origin could not be verified.");
const capabilities = await health.json();
if (capabilities.mode !== "invite-only-tester-pilot" || capabilities.generationEnabled !== freeAi) throw new Error("Gateway and origin pilot settings do not match.");
config.main = path.resolve("pilot", "src", "worker.js");
config.vars = { ...config.vars, ORIGIN_URL: origin, PILOT_AI_ENABLED: freeAi ? "true" : "false", PILOT_AI_PROVIDER: "ollama" };
config.d1_databases[0].migrations_dir = path.resolve("pilot", "migrations");
const file = path.join(directory, "deploy.json");
await writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
const secretsFile = path.join(directory, "worker-secrets.json");
await writeFile(secretsFile, JSON.stringify(Object.fromEntries(["SESSION_SECRET", "ORIGIN_SECRET", "ADMIN_SECRET"].map((name) => {
  if (typeof owner[name] !== "string" || owner[name].length < 32) throw new Error("Invalid private pilot credential bundle.");
  return [name, owner[name]];
}))), { mode: 0o600 });
const cli = path.resolve("pilot", "node_modules", "wrangler", "bin", "wrangler.js");
// Refresh/check the existing owner OAuth session before remote service mutations.
const authenticated = spawnSync(process.execPath, [cli, "whoami"], { windowsHide: true, encoding: "utf8" });
if (authenticated.status !== 0) throw new Error("Cloudflare owner authentication could not be checked. Run Wrangler login in your own shell.");
for (const args of [["d1", "migrations", "apply", config.d1_databases[0].database_name, "--remote"], ["deploy"], ["secret", "bulk", secretsFile]]) {
  const result = spawnSync(process.execPath, [cli, ...args, "--config", file], { windowsHide: true, stdio: "inherit" });
  if (result.status !== 0) throw new Error("Pilot deployment stopped. See the classified CLI result above; credentials were not printed.");
}
console.log("Pilot gateway deployed. Paid generation stays disabled; only the explicitly configured local provider can run.");
