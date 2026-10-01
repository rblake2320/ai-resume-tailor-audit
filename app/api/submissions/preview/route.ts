import { createHash, timingSafeEqual } from "node:crypto";
import { browserSubmissionPreview, BrowserSubmissionSchema } from "@/lib/submission-preview";
import { HttpLimitError, readJsonBody } from "@/lib/http-limits";

export async function POST(request: Request) {
  const secret = process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET;
  const supplied = request.headers.get("x-resume-foundry-human-approval");
  if (!secret || !supplied || !timingSafeEqual(createHash("sha256").update(secret).digest(), createHash("sha256").update(supplied).digest())) return Response.json({ error: "Human review authentication required." }, { status: 403, headers: { "cache-control": "no-store" } });
  try { return Response.json(await browserSubmissionPreview(BrowserSubmissionSchema.parse(await readJsonBody(request, 512_000))), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof HttpLimitError ? error.message : "Invalid, unready or tampered application preview." }, { status: error instanceof HttpLimitError ? error.status : 400, headers: { "cache-control": "no-store" } }); }
}
