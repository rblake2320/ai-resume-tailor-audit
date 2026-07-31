import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AGENT_OPERATIONS } from "./agent-service";
import { createResumeFoundryMcpServer } from "../scripts/mcp-server";

let root = "";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "foundry-mcp-")); process.env.RESUME_FOUNDRY_AGENT_STORE = path.join(root, "store.json"); });
afterEach(async () => { delete process.env.RESUME_FOUNDRY_AGENT_STORE; await rm(root, { recursive: true, force: true }); });
describe("MCP protocol", () => {
  it("lists every operation and executes through the shared policy service", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createResumeFoundryMcpServer(); const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools(); expect(tools.tools.map((tool) => tool.name).sort()).toEqual([...AGENT_OPERATIONS].sort());
    const result = await client.callTool({ name: "jobs.import", arguments: { input: { title: "Engineer", company: "Acme", description: "Build secure and reliable software systems." } } });
    expect(result.isError).not.toBe(true);
    const content = (result as { content: { type: string; text?: string }[] }).content[0]; expect(content.type).toBe("text");
    expect(JSON.parse(content.type === "text" ? (content.text ?? "{}") : "{}")).toMatchObject({ ok: true, operation: "jobs.import" });
    await client.close(); await server.close();
  });
});
