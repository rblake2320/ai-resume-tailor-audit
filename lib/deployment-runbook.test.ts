import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf8");

const operationalVariables = [
  "RESUME_FOUNDRY_AGENT_AUDIT_KEY",
  "RESUME_FOUNDRY_WINDOWS_ACL_MODE",
  "RESUME_FOUNDRY_RATE_LIMIT_DIR",
  "RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR",
  "RESUME_FOUNDRY_NONCE_STORE",
  "RESUME_FOUNDRY_PUBLIC_ORIGIN",
  "RESUME_FOUNDRY_MCP_ENABLED",
] as const;

describe("deployment documentation", () => {
  it("documents every fail-closed operational variable in the example and runbook", () => {
    const example = read(".env.example");
    const runbook = read("docs/DEPLOYMENT.md");
    for (const variable of operationalVariables) {
      expect(example, `${variable} missing from .env.example`).toContain(variable);
      expect(runbook, `${variable} missing from deployment runbook`).toContain(variable);
    }
  });

  it("links the runbook from the quick start and does not claim the API key is the only production requirement", () => {
    const readme = read("README.md");
    expect(readme).toContain("docs/DEPLOYMENT.md");
    expect(readme).not.toMatch(/only required variable is `ANTHROPIC_API_KEY`/i);
  });

  it("keeps the Windows ACL inventory aligned with the submission attempt store", () => {
    expect(read("docs/WINDOWS_STORAGE_ACL.md")).toContain("RESUME_FOUNDRY_SUBMISSION_ATTEMPT_DIR");
  });
});
