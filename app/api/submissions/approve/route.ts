import { NextResponse } from "next/server";
import { issueSubmissionApproval, SubmissionPreviewSchema } from "@/lib/submission-connectors";

export async function POST(request: Request) {
  const secret = process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET;
  if (!secret || request.headers.get("x-resume-foundry-human-approval") !== secret) return NextResponse.json({ error: "Explicit human approval is required." }, { status: 403 });
  try { return NextResponse.json(issueSubmissionApproval(SubmissionPreviewSchema.parse(await request.json()), secret)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid preview." }, { status: 400 }); }
}
