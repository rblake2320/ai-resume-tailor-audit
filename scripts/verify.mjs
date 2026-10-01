import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) throw new Error("Run this verifier with npm run verify.");
const directory = path.resolve(".resume-foundry", "verification");
mkdirSync(directory, { recursive: true });
const checks = [];
for (const [name, args] of [
  ["lint", ["run", "lint"]], ["typecheck", ["run", "typecheck"]],
  ["tests", ["test"]], ["build", ["run", "build"]],
  ["audit", ["audit", "--audit-level=low"]],
]) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [npmCli, ...args], { encoding: "utf8", timeout: 300_000 });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
  writeFileSync(path.join(directory, `${name}.txt`), log);
  checks.push({ name, status: result.status === 0 && !result.error ? "Worked" : "Failed", exitCode: result.status, durationMs: Date.now() - started });
  console.log(`${name}: ${checks.at(-1).status}`);
  if (checks.at(-1).status === "Failed") { console.error(log); break; }
}
writeFileSync(path.join(directory, "results.json"), JSON.stringify({ observedAt: new Date().toISOString(), node: process.version, checks }, null, 2));
if (checks.length !== 5 || checks.some((check) => check.status !== "Worked")) process.exitCode = 1;
