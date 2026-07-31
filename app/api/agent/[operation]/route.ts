import { NextResponse } from "next/server";
import { AGENT_OPERATIONS, executeAgentOperation, queryAuditLog, type AgentOperation } from "@/lib/agent-service";
import { HttpLimitError, readJsonBody } from "@/lib/http-limits";

export const AGENT_BODY_MAX_BYTES = 512_000;

function authorized(request: Request) {
  const expected = process.env.RESUME_FOUNDRY_AGENT_API_TOKEN;
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
}

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: "Agent API authentication required." }, { status: 401 });
  const { operation } = await context.params;
  if (!AGENT_OPERATIONS.includes(operation as AgentOperation)) return NextResponse.json({ error: "Unknown operation." }, { status: 404 });
  try {
    const body = await readJsonBody(request, AGENT_BODY_MAX_BYTES) as Record<string, unknown>;
    if (!body || Array.isArray(body) || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    const result = await executeAgentOperation({ operation: operation as AgentOperation, input: (body.input ?? {}) as Record<string, unknown>,
      actor: String(body.actor ?? "http-agent"), piiApproved: body.piiApproved === true,
      humanApprovalSecret: request.headers.get("x-resume-foundry-human-approval") ?? undefined });
    return NextResponse.json(result, { status: result.ok ? 200 : 403 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: error instanceof HttpLimitError ? error.status : 400 }); }
}

export async function GET(request: Request, context: { params: Promise<{ operation: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: "Agent API authentication required." }, { status: 401 });
  const { operation } = await context.params;
  if (operation !== "audit") return NextResponse.json({ error: "Unknown operation." }, { status: 404 });
  return NextResponse.json({ entries: await queryAuditLog() });
}
