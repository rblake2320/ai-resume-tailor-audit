#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// The explicit `.ts` extension is required: `node --experimental-strip-types`
// performs no ESM extension resolution, so the extensionless specifier made
// `npm run mcp` fail with ERR_MODULE_NOT_FOUND. The suite did not catch it
// because vitest resolves bundler-style.
import { AGENT_OPERATIONS, executeAgentOperation, type AgentOperation } from "../lib/agent-service.ts";

/**
 * Operations withheld from the stdio surface.
 *
 * `applications.approve` previously advertised `humanApprovalSecret` as a tool
 * argument, which published a human-held secret into the model's own context
 * and let the model approve on the human's behalf — the HTTP route deliberately
 * accepts that secret only from a header for exactly this reason. The remaining
 * operations read or write raw packet PII behind a `piiApproved` boolean that a
 * model can simply assert about itself.
 *
 * Both classes stay HTTP-only, where the approval can arrive out-of-band from a
 * human rather than from the agent making the request.
 */
const HTTP_ONLY_OPERATIONS: readonly AgentOperation[] = [
  "applications.approve",
  "applications.prepare",
  "applications.review",
  "applications.open_handoff",
  "applications.mark_submitted",
];

export const MCP_OPERATIONS = AGENT_OPERATIONS.filter((operation) => !HTTP_ONLY_OPERATIONS.includes(operation));

export function createResumeFoundryMcpServer() {
  const server = new McpServer({ name: "resume-foundry", version: "1.0.0" });
  for (const operation of MCP_OPERATIONS) {
    server.registerTool(operation, {
      description: `Resume Foundry operation ${operation}. Runs through the same executeAgentOperation policy boundary as HTTP. Approval-gated and PII-bearing operations are not exposed over stdio.`,
      // No `humanApprovalSecret` and no `piiApproved`: neither may originate
      // from the model. Operations needing them are not registered here.
      inputSchema: { input: z.record(z.string(), z.unknown()).default({}), actor: z.string().default("mcp-agent") },
    },
    async (arguments_) => {
      // Fields are passed explicitly rather than spread, so a future schema
      // change cannot smuggle `operation`, `piiApproved`, or an approval
      // secret in from tool arguments.
      const result = await executeAgentOperation({
        operation,
        input: arguments_.input ?? {},
        actor: arguments_.actor ?? "mcp-agent",
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: !result.ok };
    });
  }
  return server;
}

/**
 * A stdio server has no bearer token to check — its real trust boundary is the
 * local user who launched the process. The previous documentation claimed
 * bearer authentication for MCP, which was untrue. Rather than fake a check
 * whose secret the launcher already holds, require an explicit opt-in so the
 * surface cannot be exposed by accident, and state the boundary honestly.
 */
export function assertMcpEnabled(env: Record<string, string | undefined> = process.env) {
  if (env.RESUME_FOUNDRY_MCP_ENABLED !== "true") {
    throw new Error(
      "Refusing to start: set RESUME_FOUNDRY_MCP_ENABLED=true to expose the stdio MCP surface. " +
      "Anyone who can reach this process's stdio has full access to the operations it registers.",
    );
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/mcp-server.ts")) {
  assertMcpEnabled();
  await createResumeFoundryMcpServer().connect(new StdioServerTransport());
}
