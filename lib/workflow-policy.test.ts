import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("CI workflow policy", () => {
  it("pins third-party actions and uses least privilege", async () => {
    const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const actions = [...workflow.matchAll(/uses:\s*([^\s#]+)/gu)].map((match) => match[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action).toMatch(/@[a-f0-9]{40}$/u);
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("timeout-minutes: 15");
    expect(workflow).toMatch(/on:\s*\n\s+push:[\s\S]*?\n\s+pull_request:\s*\n\s+branches:/u);
    expect(workflow).not.toMatch(/concurrency:[\s\S]*?pull_request:/u);
  });
});
