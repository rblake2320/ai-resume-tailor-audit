import { NextResponse } from "next/server";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    service: "resume-foundry",
    version: "1.0.0",
    privacy: {
      profilePersistence: "browser-local-storage",
      serverSideProfileCopy: false,
      generationProcessor: "anthropic-api",
    },
    contracts: { openapi: "/openapi.json", agentGuide: "/AGENT_ACCESS.md" },
    operations: [
      { id: "fetchJob", method: "POST", path: "/api/fetch-job", openWorld: true },
      { id: "parseResume", method: "POST", path: "/api/parse-resume", openWorld: false },
      { id: "tailorResume", method: "POST", path: "/api/tailor", openWorld: true, streaming: "ndjson" },
    ],
    limitations: [
      "No public authentication or multi-user isolation.",
      "No MCP or A2A endpoint yet.",
      "Browser-local profiles, save points, and history are not server-readable.",
      "Human review is required before using generated application materials.",
    ],
  });
}
