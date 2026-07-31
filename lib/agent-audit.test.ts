import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "../app/api/agent/[operation]/route";
import { executeAgentOperation, queryAuditLog, UNAUTHENTICATED_DENIALS_PER_UTC_DAY } from "./agent-service";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "foundry-audit-"));
  process.env.RESUME_FOUNDRY_AGENT_STORE = path.join(root, "store.json");
  process.env.RESUME_FOUNDRY_AGENT_API_TOKEN = "test-http-token";
  process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY = "test-only-audit-key-with-32-bytes-minimum";
});
afterEach(async () => {
  delete process.env.RESUME_FOUNDRY_AGENT_STORE;
  delete process.env.RESUME_FOUNDRY_AGENT_API_TOKEN;
  delete process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY;
  await rm(root, { recursive: true, force: true });
});

const context = (operation: string) => ({ params: Promise.resolve({ operation }) });

describe("authenticated, tamper-evident agent audit", () => {
  it("attributes HTTP calls to the authenticated credential, never the caller body", async () => {
    const response = await POST(new Request("http://localhost/api/agent/jobs.search", {
      method: "POST",
      headers: { authorization: "Bearer test-http-token", "content-type": "application/json" },
      body: JSON.stringify({ input: { query: "engineer" } }),
    }), context("jobs.search"));
    expect(response.status).toBe(200);
    const forged = await POST(new Request("http://localhost/api/agent/jobs.search", {
      method: "POST",
      headers: { authorization: "Bearer test-http-token", "content-type": "application/json" },
      body: JSON.stringify({ actor: "forged-admin", input: { query: "engineer" } }),
    }), context("jobs.search"));
    expect(forged.status).toBe(400);
    const page = await queryAuditLog();
    expect(page.entries.map((entry) => entry.actor)).toEqual([
      expect.stringMatching(/^http:[a-f0-9]{16}$/u), expect.stringMatching(/^http:[a-f0-9]{16}$/u),
    ]);
    expect(JSON.stringify(page)).not.toContain("forged-admin");
    expect(page.entries.at(-1)?.reasonCode).toBe("INVALID_REQUEST");
  });

  it("records authentication, unknown-operation, and malformed-request denials without raw values", async () => {
    expect((await POST(new Request("http://localhost/api/agent/jobs.search", { method: "POST", body: JSON.stringify({ input: { ssn: "555-00-1234" } }) }), context("jobs.search"))).status).toBe(401);
    expect((await POST(new Request("http://localhost/api/agent/not-real", { method: "POST", headers: { authorization: "Bearer test-http-token", "content-type": "application/json" }, body: "{}" }), context("not-real"))).status).toBe(404);
    expect((await POST(new Request("http://localhost/api/agent/jobs.search", { method: "POST", headers: { authorization: "Bearer test-http-token", "content-type": "application/json" }, body: "not-json" }), context("jobs.search"))).status).toBe(400);
    const serialized = JSON.stringify((await queryAuditLog()).entries);
    expect(serialized).not.toContain("555-00-1234");
    expect(serialized).not.toContain("test-http-token");
    expect((await queryAuditLog()).entries.map((entry) => entry.reasonCode)).toEqual(["AUTHENTICATION_REQUIRED", "UNKNOWN_OPERATION", "INVALID_REQUEST"]);
  });

  it("durably bounds unauthenticated denial growth while retaining the first denials", async () => {
    for (let index = 0; index < UNAUTHENTICATED_DENIALS_PER_UTC_DAY + 5; index += 1) {
      const response = await POST(new Request("http://localhost/api/agent/jobs.search", { method: "POST" }), context("jobs.search"));
      expect(response.status).toBe(401);
    }
    const entries = (await queryAuditLog({ limit: 100 })).entries;
    expect(entries).toHaveLength(UNAUTHENTICATED_DENIALS_PER_UTC_DAY);
    expect(entries.every((entry) => entry.reasonCode === "AUTHENTICATION_REQUIRED")).toBe(true);
  });

  it("rejects a non-boolean PII approval before policy evaluation and audits the schema denial", async () => {
    for (const operation of ["jobs.search", "applications.review"]) {
      const response = await POST(new Request(`http://localhost/api/agent/${operation}`, {
        method: "POST",
        headers: { authorization: "Bearer test-http-token", "content-type": "application/json" },
        body: JSON.stringify({ input: {}, piiApproved: "not-a-boolean" }),
      }), context(operation));
      expect(response.status).toBe(400);
    }
    const entries = (await queryAuditLog()).entries;
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => !entry.allowed && entry.reasonCode === "INVALID_REQUEST")).toBe(true);
  });

  it("rejects a rewritten audit record even when its input hash is well formed", async () => {
    await executeAgentOperation({ operation: "jobs.search", input: {}, actor: "internal:test" });
    const target = process.env.RESUME_FOUNDRY_AGENT_STORE!;
    const stored = JSON.parse(await readFile(target, "utf8"));
    stored.audit[0].allowed = false;
    await writeFile(target, JSON.stringify(stored));
    await expect(queryAuditLog()).rejects.toThrow(/authentication/i);
  });

  it("returns bounded cursor pages and refuses oversized limits", async () => {
    for (let index = 0; index < 5; index += 1) await executeAgentOperation({ operation: "jobs.search", input: { query: String(index) }, actor: "internal:test" });
    const first = await queryAuditLog({ limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await queryAuditLog({ limit: 2, cursor: first.nextCursor! });
    expect(second.entries).toHaveLength(2);
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(4);
    await expect(queryAuditLog({ limit: 101 })).rejects.toThrow(/limit/i);

    const response = await GET(new Request("http://localhost/api/agent/audit?limit=2", { headers: { authorization: "Bearer test-http-token" } }), context("audit"));
    expect(response.status).toBe(200);
    expect((await response.json()).entries).toHaveLength(2);

    const invalid = await GET(new Request("http://localhost/api/agent/audit?limit=101", { headers: { authorization: "Bearer test-http-token" } }), context("audit"));
    expect(invalid.status).toBe(400);
    expect((await queryAuditLog()).entries.at(-1)?.reasonCode).toBe("INVALID_AUDIT_QUERY");

    for (const query of ["limit=2&limit=3", "unknown=value"]) {
      const strict = await GET(new Request(`http://localhost/api/agent/audit?${query}`, { headers: { authorization: "Bearer test-http-token" } }), context("audit"));
      expect(strict.status).toBe(400);
      expect((await queryAuditLog()).entries.at(-1)?.reasonCode).toBe("INVALID_AUDIT_QUERY");
    }
  });

  it("fails closed before mutation when the independent audit key is unavailable", async () => {
    delete process.env.RESUME_FOUNDRY_AGENT_AUDIT_KEY;
    const result = await executeAgentOperation({ operation: "jobs.import", input: { title: "Engineer", company: "Acme", description: "Build reliable systems securely." }, actor: "internal:test" });
    expect(result).toMatchObject({ ok: false, error: "The authenticated agent audit is unavailable." });
    await expect(readFile(process.env.RESUME_FOUNDRY_AGENT_STORE!, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
