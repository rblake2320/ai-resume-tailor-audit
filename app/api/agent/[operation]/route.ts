import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AGENT_OPERATIONS, executeAgentOperation, queryAuditLog, recordAgentDenial, type AgentOperation } from "@/lib/agent-service";
import { HttpLimitError, readJsonBody } from "@/lib/http-limits";

export const AGENT_BODY_MAX_BYTES = 512_000;
const AgentHttpBodySchema = z.strictObject({
  input: z.record(z.string(), z.unknown()).default({}),
  piiApproved: z.boolean().default(false),
});

function authenticatedActor(request: Request): string | null {
  const expected = process.env.RESUME_FOUNDRY_AGENT_API_TOKEN;
  const supplied = request.headers.get("authorization");
  if (!expected || !supplied) return null;
  const expectedDigest = createHash("sha256").update(`Bearer ${expected}`).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(expectedDigest, suppliedDigest)) return null;
  return `http:${createHash("sha256").update(expected).digest("hex").slice(0, 16)}`;
}

async function denial(actor: string, operation: string, reasonCode: string, input?: unknown) {
  try { await recordAgentDenial({ actor, operation, reasonCode, input }); }
  catch { /* The request still fails closed if accountability storage is unavailable. */ }
}

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const { operation } = await context.params;
  const actor = authenticatedActor(request);
  if (!actor) {
    await denial("unauthenticated", operation, "AUTHENTICATION_REQUIRED", { authorizationPresent: request.headers.has("authorization") });
    return NextResponse.json({ error: "Agent API authentication required." }, { status: 401 });
  }
  if (!AGENT_OPERATIONS.includes(operation as AgentOperation)) {
    await denial(actor, operation, "UNKNOWN_OPERATION");
    return NextResponse.json({ error: "Unknown operation." }, { status: 404 });
  }
  try {
    const body = AgentHttpBodySchema.parse(await readJsonBody(request, AGENT_BODY_MAX_BYTES));
    const result = await executeAgentOperation({ operation: operation as AgentOperation, input: body.input,
      actor, piiApproved: body.piiApproved,
      humanApprovalSecret: request.headers.get("x-resume-foundry-human-approval") ?? undefined });
    return NextResponse.json(result, { status: result.ok ? 200 : 403 });
  } catch (error) {
    await denial(actor, operation, "INVALID_REQUEST");
    return NextResponse.json({ error: error instanceof HttpLimitError ? error.message : "Invalid request." }, { status: error instanceof HttpLimitError ? error.status : 400 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ operation: string }> }) {
  const { operation } = await context.params;
  const actor = authenticatedActor(request);
  if (!actor) {
    await denial("unauthenticated", operation, "AUTHENTICATION_REQUIRED", { authorizationPresent: request.headers.has("authorization") });
    return NextResponse.json({ error: "Agent API authentication required." }, { status: 401 });
  }
  if (operation !== "audit") {
    await denial(actor, operation, "UNKNOWN_OPERATION");
    return NextResponse.json({ error: "Unknown operation." }, { status: 404 });
  }
  const url = new URL(request.url);
  const queryKeys = [...url.searchParams.keys()];
  const queryIsStrict = queryKeys.every((key) => key === "limit" || key === "cursor")
    && url.searchParams.getAll("limit").length <= 1
    && url.searchParams.getAll("cursor").length <= 1;
  if (!queryIsStrict) {
    await denial(actor, operation, "INVALID_AUDIT_QUERY");
    return NextResponse.json({ error: "Invalid audit query." }, { status: 400 });
  }
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
  try { return NextResponse.json(await queryAuditLog({ limit, cursor: url.searchParams.get("cursor") ?? undefined })); }
  catch {
    await denial(actor, operation, "INVALID_AUDIT_QUERY");
    return NextResponse.json({ error: "Invalid audit query." }, { status: 400 });
  }
}
