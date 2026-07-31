#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AGENT_OPERATIONS, executeAgentOperation } from "../lib/agent-service";

export function createResumeFoundryMcpServer() {
  const server = new McpServer({ name: "resume-foundry", version: "1.0.0" });
  for (const operation of AGENT_OPERATIONS) {
    server.registerTool(operation, { description: `Resume Foundry operation ${operation}. The same server-side permission policy as HTTP is enforced.`,
      inputSchema: { input: z.record(z.string(), z.unknown()).default({}), actor: z.string().default("mcp-agent"), piiApproved: z.boolean().default(false), humanApprovalSecret: z.string().optional() } },
    async (arguments_) => {
      const result = await executeAgentOperation({ operation, ...arguments_ });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: !result.ok };
    });
  }
  return server;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/mcp-server.ts")) {
  await createResumeFoundryMcpServer().connect(new StdioServerTransport());
}
