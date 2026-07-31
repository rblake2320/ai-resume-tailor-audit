import { NextResponse } from "next/server";
import { issueSubmissionApproval, SubmissionPreviewSchema } from "@/lib/submission-connectors";
import { HttpLimitError, readJsonBody } from "@/lib/http-limits";

export const SUBMISSION_APPROVAL_BODY_MAX_BYTES = 6_000_000;

export async function POST(request: Request) {
  const secret = process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET;
  if (!secret || request.headers.get("x-resume-foundry-human-approval") !== secret) return NextResponse.json({ error: "Explicit human approval is required." }, { status: 403 });
  try { return NextResponse.json(issueSubmissionApproval(SubmissionPreviewSchema.parse(await readJsonBody(request, SUBMISSION_APPROVAL_BODY_MAX_BYTES)), secret)); }
  catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid preview." },
      { status: error instanceof HttpLimitError ? error.status : 400 },
    );
  }
}
