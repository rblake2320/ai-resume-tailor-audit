import { describe, expect, it } from "vitest";
import spec from "../public/openapi.json";
import { AGENT_OPERATIONS } from "./agent-service";
import { MCP_OPERATIONS } from "../scripts/mcp-server";

describe("agent API and MCP contract parity", () => {
  it("publishes every policy operation in OpenAPI", () => {
    const paths = spec.paths as Record<string, unknown>;
    for (const operation of AGENT_OPERATIONS) expect(paths[`/api/agent/${operation}`]).toBeDefined();
    expect(paths["/api/agent/audit"]).toBeDefined();
  });

  it("publishes nothing under /api/agent that the policy service cannot execute", () => {
    // The generator works from a hardcoded list and never prunes, so an
    // operation could be advertised in OpenAPI while returning 404 in practice.
    // The previous test only checked the code -> spec direction.
    const advertised = Object.keys(spec.paths as Record<string, unknown>)
      .filter((route) => route.startsWith("/api/agent/"))
      .map((route) => route.replace("/api/agent/", ""))
      .filter((operation) => operation !== "audit");
    expect(advertised.sort()).toEqual([...AGENT_OPERATIONS].sort());
  });

  it("exposes a subset of the policy operations over stdio, and nothing beyond them", () => {
    // Behavioural rather than a source grep: the previous test asserted that
    // mcp-server.ts contained a particular line of source text, which would
    // have passed unchanged even if the policy boundary were bypassed entirely.
    expect(MCP_OPERATIONS.every((operation) => AGENT_OPERATIONS.includes(operation))).toBe(true);
    expect(MCP_OPERATIONS.length).toBeLessThan(AGENT_OPERATIONS.length);
  });
});
