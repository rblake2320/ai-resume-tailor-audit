import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.RESUME_FOUNDRY_PILOT_MODE === "true") return NextResponse.json({
    service: "resume-foundry", version: "1.0.0", mode: "invite-only-tester-pilot",
    authentication: "cloudflare-gateway-invite-session-and-private-origin-admission",
    generationEnabled: process.env.RESUME_FOUNDRY_PILOT_AI_ENABLED === "true",
    generationProcessor: "local-ollama-qwen3-vl-8b-instruct-no-paid-fallback",
    privacy: { profilePersistence: "participant-scoped-browser-storage", careerEvidencePersistence: "participant-scoped-encrypted-indexeddb", serverSideProfileCopy: false, telemetry: "content-free-explicit-opt-in", feedback: "voluntary-reviewed-owner-visible", sharedDataRetentionDays: 30 },
    operations: ["fetchJob", "importJobs", "parseResume", "careerEvidence", "privateTracker", "calendarFile", "testerFeedback"],
    disabled: ["agentWorkspace", "googleAccountConnection", "officialEmployerSubmissions", "mcp"],
  }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json({
    service: "resume-foundry",
    version: "1.0.0",
    privacy: {
      profilePersistence: "browser-local-storage",
      careerEvidencePersistence: "encrypted-indexeddb",
      portableEncryptedBackup: true,
      serverSideProfileCopy: false,
      reviewedPacketServerCopy: "explicit-opt-in-agent-workspace-publishing",
      generationProcessor: "anthropic-api",
    },
    contracts: { openapi: "/openapi.json", agentGuide: "/AGENT_ACCESS.md" },
    operations: [
      { id: "fetchJob", method: "POST", path: "/api/fetch-job", openWorld: true },
      { id: "importJobs", method: "POST", path: "/api/jobs/import", openWorld: true, sources: ["greenhouse", "lever", "usajobs", "email"] },
      { id: "lookupOnetOccupation", method: "POST", path: "/api/labor-market/onet", openWorld: true, source: "ONET" },
      { id: "fetchBlsObservations", method: "POST", path: "/api/labor-market/bls-series", openWorld: true, source: "BLS", observationsOnly: true },
      { id: "parseResume", method: "POST", path: "/api/parse-resume", openWorld: false },
      { id: "tailorResume", method: "POST", path: "/api/tailor", openWorld: true, streaming: "ndjson" },
      { id: "agentOperations", method: "POST", path: "/api/agent/{operation}", authentication: "bearer", humanApproval: true },
      { id: "agentAudit", method: "GET", path: "/api/agent/audit", authentication: "bearer" },
      { id: "workspaceBridge", method: "POST", path: "/api/agent/workspace.publish", authentication: "bearer", piiConsent: true, humanApproval: true, revisionConflicts: "reject" },
      { id: "googleWorkflows", method: "POST", path: "/api/connections/google/actions", authentication: "sealed-oauth-cookie", writes: "review-then-single-use-approval", actions: ["read-alerts", "unsent-draft", "private-calendar-event"] },
      { id: "submissionPreview", method: "POST", path: "/api/submissions/preview", authentication: "human-approval-header", providerWrite: false },
      { id: "mcpTools", transport: "stdio", command: "npm run mcp", authentication: "none-local-process-boundary", requiresOptIn: "RESUME_FOUNDRY_MCP_ENABLED", operations: "subset-excludes-approval-and-pii" },
    ],
    limitations: [
      "No public authentication or multi-user isolation.",
      "No A2A task endpoint or public multi-tenant identity boundary.",
      "Browser-local profiles, save points, run history and the full vault are private; explicitly approved evidence and published application packets are disclosed to the configured processor or agent server.",
      "Human review is required before using generated application materials.",
      "The stdio MCP surface has no transport authentication; its trust boundary is the local user who launched it.",
      "Approval-gated and PII-bearing operations are HTTP-only so a model cannot supply its own approval.",
    ],
  });
}
