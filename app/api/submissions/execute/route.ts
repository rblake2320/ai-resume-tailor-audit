import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createGmailDraft, submitGreenhouse, submitLever, verifySubmissionApproval, type ApprovalReceipt } from "@/lib/submission-connectors";
import { consumeSubmissionApproval } from "@/lib/submission-ledger";
import { googleOAuthConfig, openConnection } from "@/lib/google-oauth";
import type { StoredGoogleConnection } from "../../connections/google/callback/route";

function authorized(provider: string, identity: string) {
  return (process.env.RESUME_FOUNDRY_AUTHORIZED_SUBMISSION_PROVIDERS ?? "").split(",").map((item) => item.trim()).includes(`${provider}:${identity}`);
}
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>; const receipt = body.receipt as ApprovalReceipt;
    const secret = process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET; if (!secret) throw new Error("Human approval is not configured.");
    const preview = verifySubmissionApproval(receipt, secret); const provider = preview.provider;
    const identity = String(body.boardToken ?? body.site ?? "me"); if (!authorized(provider, identity)) throw new Error("Employer-side submission authorization is not configured for this provider account.");
    if (provider === "greenhouse") {
      const apiKey = process.env.GREENHOUSE_JOB_BOARD_API_KEY; if (!apiKey) throw new Error("Greenhouse credential is unavailable.");
      await consumeSubmissionApproval({ nonce: receipt.nonce, applicationId: preview.applicationId, provider, consumedAt: new Date().toISOString() });
      return NextResponse.json(await submitGreenhouse({ boardToken: identity, jobId: String(body.jobId), apiKey, fields: body.fields as Record<string, unknown>, receipt, approvalSecret: secret }));
    }
    if (provider === "lever") {
      const apiKey = process.env.LEVER_POSTINGS_API_KEY; if (!apiKey) throw new Error("Lever credential is unavailable.");
      await consumeSubmissionApproval({ nonce: receipt.nonce, applicationId: preview.applicationId, provider, consumedAt: new Date().toISOString() });
      return NextResponse.json(await submitLever({ site: identity, postingId: String(body.postingId), apiKey, requiredFields: body.requiredFields as string[], fields: body.fields as Record<string, unknown>, receipt, approvalSecret: secret }));
    }
    const sealed = (await cookies()).get("rf_google_connection")?.value; if (!sealed) throw new Error("Google OAuth connection is required.");
    const connection = openConnection<StoredGoogleConnection>(sealed, googleOAuthConfig().encryptionKey);
    if (!connection.features.includes("email_drafts")) throw new Error("Gmail draft permission was not granted.");
    await consumeSubmissionApproval({ nonce: receipt.nonce, applicationId: preview.applicationId, provider, consumedAt: new Date().toISOString() });
    return NextResponse.json(await createGmailDraft({ accessToken: connection.tokens.access_token, rawMessage: String(body.rawMessage), receipt, approvalSecret: secret }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Submission failed." }, { status: 403 }); }
}
