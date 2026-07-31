import { describe, expect, it } from "vitest";
import spec from "../public/openapi.json";
import { AGENT_OPERATIONS } from "./agent-service";

describe("agent API and MCP contract parity", () => {
  it("publishes every policy operation in OpenAPI", () => {
    const paths = spec.paths as Record<string, unknown>;
    for (const operation of AGENT_OPERATIONS) expect(paths[`/api/agent/${operation}`]).toBeDefined();
    expect(paths["/api/agent/audit"]).toBeDefined();
  });
  it("registers every same operation in the MCP server source", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../scripts/mcp-server.ts", import.meta.url), "utf8"));
    expect(source).toContain("for (const operation of AGENT_OPERATIONS)");
    expect(source).toContain("executeAgentOperation({ operation");
  });
});
