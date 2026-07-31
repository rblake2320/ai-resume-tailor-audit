import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contract = JSON.parse(readFileSync(resolve("public/openapi.json"), "utf8"));

describe("agent automation contract", () => {
  it("publishes every current HTTP operation with stable operation IDs", () => {
    expect(contract.openapi).toBe("3.1.0");
    expect(contract.paths["/api/capabilities"].get.operationId).toBe("getCapabilities");
    expect(contract.paths["/api/fetch-job"].post.operationId).toBe("fetchJob");
    expect(contract.paths["/api/parse-resume"].post.operationId).toBe("parseResume");
    expect(contract.paths["/api/tailor"].post.operationId).toBe("tailorResume");
  });

  it("documents human review and the trusted-local boundary", () => {
    expect(contract.info.description).toContain("human review");
    const guide = readFileSync(resolve("public/AGENT_ACCESS.md"), "utf8");
    expect(guide).toContain("human approval");
    expect(guide).toContain("Not implemented yet");
  });
});
