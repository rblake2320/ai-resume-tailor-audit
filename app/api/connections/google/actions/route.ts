import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { googleOAuthConfig, openConnection, sealConnection } from "@/lib/google-oauth";
import { executeGoogleWrite, freshGoogleConnection, GoogleApprovalSchema, GoogleConnectionSchema, GoogleWriteActionSchema, readGoogleJobAlerts, requireGoogleFeature } from "@/lib/google-workflows";
import { HttpLimitError, readJsonBody } from "@/lib/http-limits";
import { enforcePublicRateLimit } from "@/lib/durable-rate-limit";
import { configuredNonceStore } from "@/lib/nonce-store";
import { isSameOriginMutation } from "../disconnect/route";

export const runtime = "nodejs";
const RequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read_alerts"), query: z.string().trim().min(1).max(300) }),
  z.strictObject({ operation: z.literal("review"), action: GoogleWriteActionSchema }),
  z.strictObject({ operation: z.literal("approve"), approvalId: z.string().uuid() }),
]);
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) return json({ error: "Same-origin request required." }, 403);
  const limited = enforcePublicRateLimit("google-actions", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  let input: z.infer<typeof RequestSchema>;
  try { input = RequestSchema.parse(await readJsonBody(request, 8 * 1024)); }
  catch (error) { return json({ error: error instanceof HttpLimitError ? error.message : "Google action did not match the request contract." }, error instanceof HttpLimitError ? error.status : 400); }
  const jar = await cookies();
  try {
    const sealed = jar.get("rf_google_connection")?.value;
    if (!sealed) return json({ error: "Connect Google before using this action." }, 401);
    const config = googleOAuthConfig();
    const connection = GoogleConnectionSchema.parse(openConnection(sealed, config.encryptionKey));
    const binding = createHash("sha256").update(connection.tokens.refresh_token ?? connection.tokens.access_token).digest("hex");
    if (input.operation === "review") {
      requireGoogleFeature(connection, input.action.type === "calendar_event" ? "calendar_events" : "email_drafts");
      // Validate the deployment replay store before presenting an executable review.
      configuredNonceStore();
      const review = { id: randomUUID(), connectionBinding: binding, expiresAt: Date.now() + 5 * 60_000, action: input.action };
      const encrypted = sealConnection(review, config.encryptionKey);
      if (encrypted.length > 3_800) return json({ error: "Review is too large. Shorten the message or event description." }, 413);
      jar.set("rf_google_action_review", encrypted, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 300 });
      return json({ review: { id: review.id, action: review.action, expiresAt: review.expiresAt } });
    }
    let review: z.infer<typeof GoogleApprovalSchema> | undefined;
    if (input.operation === "approve") {
      const encrypted = jar.get("rf_google_action_review")?.value;
      if (!encrypted) return json({ error: "Review this action before approving it." }, 409);
      review = GoogleApprovalSchema.parse(openConnection(encrypted, config.encryptionKey));
      if (review.id !== input.approvalId || review.connectionBinding !== binding || review.expiresAt <= Date.now()) return json({ error: "Review is expired or belongs to a different Google connection." }, 409);
      requireGoogleFeature(connection, review.action.type === "calendar_event" ? "calendar_events" : "email_drafts");
      // Atomic single-use claim comes before any provider write, across workers.
      if (!configuredNonceStore().consume(`google-action:${review.id}`)) return json({ error: "This approval was already used. Check Google before creating another action." }, 409);
      jar.delete("rf_google_action_review");
    } else requireGoogleFeature(connection, "email_alerts");
    const refreshed = await freshGoogleConnection(connection, config);
    if (refreshed !== connection) jar.set("rf_google_connection", sealConnection(refreshed, config.encryptionKey), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 90 * 86_400 });
    if (input.operation === "read_alerts") return json({ alerts: await readGoogleJobAlerts(refreshed, input.query) });
    if (!review) throw new Error("Missing reviewed Google action.");
    return json({ receipt: await executeGoogleWrite(refreshed, review.action, review.id) });
  } catch (error) {
    // Never echo provider bodies, tokens or private message contents in errors.
    const needsConfig = error instanceof Error && /must be configured|not configured/.test(error.message);
    return json({ error: needsConfig ? "Google workflow prerequisites are not configured on this server." : input.operation === "approve" ? "Google action could not be verified. Check Google before creating another action; this approval will not be retried." : "Google workflow unavailable or returned invalid data. Reconnect if access expired." }, needsConfig ? 503 : 502);
  }
}
