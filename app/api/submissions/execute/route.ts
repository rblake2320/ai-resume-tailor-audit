import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ApprovalReceiptSchema, assertApprovedPacket, createGmailDraft, submitGreenhouse, submitLever, verifySubmissionApproval, type SubmissionPreview } from "@/lib/submission-connectors";
import { verifyApplicationPacket, type ApplicationPacket } from "@/lib/applications";
import { consumeSubmissionApproval } from "@/lib/submission-ledger";
import { googleOAuthConfig, openConnection } from "@/lib/google-oauth";
import type { StoredGoogleConnection } from "../../connections/google/callback/route";

function authorized(provider: string, identity: string) {
  return (process.env.RESUME_FOUNDRY_AUTHORIZED_SUBMISSION_PROVIDERS ?? "")
    .split(",").map((item) => item.trim()).filter(Boolean)
    .includes(`${provider}:${identity}`);
}

/**
 * The provider account comes from the signed target, never the request body.
 * It previously came from `body.boardToken ?? body.site ?? "me"`, so a caller
 * could aim an approved receipt at any other allowlisted account.
 */
function approvedIdentity(preview: SubmissionPreview) {
  switch (preview.target.provider) {
    case "greenhouse": return preview.target.boardToken;
    case "lever": return preview.target.site;
    case "gmail": return "me";
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const secret = process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET;
    if (!secret) throw new Error("Human approval is not configured.");

    // Everything transmitted downstream is read from this verified preview.
    // The request body contributes nothing but the receipt itself.
    const receipt = ApprovalReceiptSchema.parse(body.receipt);
    const preview = verifySubmissionApproval(receipt, secret);
    const provider = preview.provider;
    if (!authorized(provider, approvedIdentity(preview))) {
      throw new Error("Employer-side submission authorization is not configured for this provider account.");
    }

    // The exact frozen packet must be presented, must be internally consistent,
    // and must be the one that was approved. Integrity is checked first so a
    // packet cannot satisfy the binding using checksums of its own tampered
    // content.
    const packet = body.packet as ApplicationPacket | undefined;
    if (!packet?.checksums) throw new Error("The approved application packet must be presented for submission.");
    const integrity = await verifyApplicationPacket(packet);
    if (!integrity.valid) throw new Error(`Application packet failed integrity verification: ${integrity.errors.join(" ")}`);
    assertApprovedPacket(preview, packet);
    const use = { nonce: receipt.nonce, applicationId: preview.applicationId, provider, consumedAt: new Date().toISOString() };

    if (provider === "greenhouse") {
      const apiKey = process.env.GREENHOUSE_JOB_BOARD_API_KEY;
      if (!apiKey) throw new Error("Greenhouse credential is unavailable.");
      await consumeSubmissionApproval(use);
      return NextResponse.json(await submitGreenhouse({ apiKey, receipt, approvalSecret: secret }));
    }
    if (provider === "lever") {
      const apiKey = process.env.LEVER_POSTINGS_API_KEY;
      if (!apiKey) throw new Error("Lever credential is unavailable.");
      await consumeSubmissionApproval(use);
      return NextResponse.json(await submitLever({ apiKey, receipt, approvalSecret: secret }));
    }

    const sealed = (await cookies()).get("rf_google_connection")?.value;
    if (!sealed) throw new Error("Google OAuth connection is required.");
    const connection = openConnection<StoredGoogleConnection>(sealed, googleOAuthConfig().encryptionKey);
    if (!connection.features.includes("email_drafts")) throw new Error("Gmail draft permission was not granted.");
    await consumeSubmissionApproval(use);
    return NextResponse.json(await createGmailDraft({ accessToken: connection.tokens.access_token, receipt, approvalSecret: secret }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Submission failed." }, { status: 403 });
  }
}
