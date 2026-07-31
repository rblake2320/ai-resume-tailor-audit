import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AGENT_OPERATIONS } from "./agent-service";
import { assertMcpEnabled, createResumeFoundryMcpServer, MCP_OPERATIONS } from "../scripts/mcp-server";

const run = promisify(execFile);
const serverPath = path.join(import.meta.dirname, "..", "scripts", "mcp-server.ts");

let root = "";
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "foundry-mcp-")); process.env.RESUME_FOUNDRY_AGENT_STORE = path.join(root, "store.json"); process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY = "test-only-audit-key-with-32-bytes-minimum"; });
afterEach(async () => { delete process.env.RESUME_FOUNDRY_AGENT_STORE; delete process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY; await rm(root, { recursive: true, force: true }); });

describe("MCP protocol", () => {
  it("starts under native Node type stripping", async () => {
    // Regression: `../lib/agent-service` carried no extension, and
    // `node --experimental-strip-types` performs no ESM extension resolution,
    // so `npm run mcp` died with ERR_MODULE_NOT_FOUND. The suite missed it
    // because vitest resolves bundler-style. This spawns the real entrypoint,
    // so a resolution failure surfaces as ERR_MODULE_NOT_FOUND rather than the
    // expected opt-in refusal.
    const result = await run(process.execPath, ["--experimental-strip-types", serverPath], {
      env: { ...process.env, RESUME_FOUNDRY_MCP_ENABLED: "" }, timeout: 30_000,
    }).catch((error: { stderr?: string }) => error);
    const stderr = (result as { stderr?: string }).stderr ?? "";
    expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(stderr).toContain("RESUME_FOUNDRY_MCP_ENABLED");
  }, 40_000);

  it("refuses to expose the stdio surface without an explicit opt-in", () => {
    // stdio has no bearer token to check — its real trust boundary is the local
    // user who launched the process. The docs previously claimed bearer auth for
    // MCP, which was untrue.
    expect(() => assertMcpEnabled({})).toThrow(/RESUME_FOUNDRY_MCP_ENABLED/);
    expect(() => assertMcpEnabled({ RESUME_FOUNDRY_MCP_ENABLED: "1" })).toThrow(/RESUME_FOUNDRY_MCP_ENABLED/);
    expect(() => assertMcpEnabled({ RESUME_FOUNDRY_MCP_ENABLED: "true" })).not.toThrow();
  });

  it("never exposes an approval secret or a PII flag as a model-suppliable argument", async () => {
    // Regression: every tool advertised `humanApprovalSecret`, publishing a
    // human-held secret into the model's own context and letting the model
    // approve on the human's behalf — while the HTTP route deliberately accepts
    // that secret only from a header.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createResumeFoundryMcpServer(); const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const schemas = JSON.stringify((await client.listTools()).tools.map((tool) => tool.inputSchema));
    expect(schemas).not.toContain("humanApprovalSecret");
    expect(schemas).not.toContain("piiApproved");
    await client.close(); await server.close();
  });

  it("withholds approval-gated and PII-bearing operations from stdio", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createResumeFoundryMcpServer(); const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names.sort()).toEqual([...MCP_OPERATIONS].sort());
    for (const withheld of ["applications.approve", "applications.prepare", "applications.review", "applications.open_handoff", "applications.mark_submitted"]) {
      expect(names).not.toContain(withheld);
    }
    expect(MCP_OPERATIONS.length).toBeLessThan(AGENT_OPERATIONS.length);
    await client.close(); await server.close();
  });

  it("executes an exposed operation through the shared policy service", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createResumeFoundryMcpServer(); const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "jobs.import", arguments: { input: { title: "Engineer", company: "Acme", description: "Build secure and reliable software systems." } } });
    expect(result.isError).not.toBe(true);
    const content = (result as { content: { type: string; text?: string }[] }).content[0];
    expect(JSON.parse(content.type === "text" ? (content.text ?? "{}") : "{}")).toMatchObject({ ok: true, operation: "jobs.import" });
    await client.close(); await server.close();
  });
});
