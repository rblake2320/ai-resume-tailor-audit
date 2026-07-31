import { NextResponse } from "next/server";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    service: "resume-foundry",
    version: "1.1.0",
    privacy: {
      profilePersistence: "browser-local-storage",
      careerEvidencePersistence: "encrypted-indexeddb",
      portableEncryptedBackup: true,
      serverSideProfileCopy: false,
      generationProcessor: "anthropic-api",
    },
    contracts: { openapi: "/openapi.json", agentGuide: "/AGENT_ACCESS.md" },
    operations: [
      { id: "fetchJob", method: "POST", path: "/api/fetch-job", openWorld: true },
      { id: "importJobs", method: "POST", path: "/api/jobs/import", openWorld: true, sources: ["greenhouse", "lever", "usajobs", "email"] },
      { id: "parseResume", method: "POST", path: "/api/parse-resume", openWorld: false },
      { id: "tailorResume", method: "POST", path: "/api/tailor", openWorld: true, streaming: "ndjson" },
      { id: "agentOperations", method: "POST", path: "/api/agent/{operation}", authentication: "bearer", humanApproval: true },
      { id: "agentAudit", method: "GET", path: "/api/agent/audit", authentication: "bearer" },
      { id: "mcpTools", transport: "stdio", command: "npm run mcp", humanApproval: true },
    ],
    limitations: [
      "No public authentication or multi-user isolation.",
      "No A2A task endpoint or public multi-tenant identity boundary.",
      "Browser-local profiles, save points, run history, and encrypted career evidence are not server-readable.",
      "Human review is required before using generated application materials.",
    ],
  });
}
