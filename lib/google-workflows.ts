import { z } from "zod";
import { GOOGLE_SCOPES, type GoogleFeature, type GoogleOAuthConfig, type GoogleTokenSet } from "./google-oauth.ts";
import { providerFetch, providerJson } from "./provider-http.ts";

export const GoogleConnectionSchema = z.object({
  features: z.array(z.enum(["email_alerts", "email_drafts", "calendar_events"])).min(1).max(3),
  tokens: z.object({ access_token: z.string().min(1).max(16_384), refresh_token: z.string().min(1).max(16_384).optional(), expires_in: z.number().int().positive().max(604_800), scope: z.string().min(1).max(16_384), token_type: z.literal("Bearer"), obtainedAt: z.number().finite().nonnegative() }),
});
export type GoogleConnection = z.infer<typeof GoogleConnectionSchema>;

const EventSchema = z.strictObject({
  type: z.literal("calendar_event"), title: z.string().trim().min(1).max(200),
  description: z.string().max(1_000), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }),
  reminderMinutes: z.number().int().min(0).max(10_080),
}).refine((value) => Date.parse(value.end) > Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 86_400_000, "Event must end after it starts and last at most one day.");
const DraftSchema = z.strictObject({ type: z.literal("email_draft"), to: z.string().email().max(254).regex(/^[^\r\n<>]+$/), subject: z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/), body: z.string().min(1).max(1_000) });
export const GoogleWriteActionSchema = z.union([EventSchema, DraftSchema]);
export type GoogleWriteAction = z.infer<typeof GoogleWriteActionSchema>;
export const GoogleApprovalSchema = z.strictObject({ id: z.string().uuid(), connectionBinding: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().finite(), action: GoogleWriteActionSchema });

function featureFor(action: GoogleWriteAction): GoogleFeature { return action.type === "calendar_event" ? "calendar_events" : "email_drafts"; }
export function requireGoogleFeature(connection: GoogleConnection, feature: GoogleFeature) {
  if (!connection.features.includes(feature) || !connection.tokens.scope.split(" ").includes(GOOGLE_SCOPES[feature])) throw new Error("Reconnect Google with the permission required for this action.");
}
async function jsonRequest(url: string, tokens: GoogleTokenSet, init: RequestInit, fetcher: typeof fetch, maxBytes = 1_000_000) {
  const response = await providerFetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" }, fetcher);
  if (!response.ok) {
    await response.body?.cancel("Google action rejected").catch(() => undefined);
    throw new Error(`Google action failed (${response.status}).`);
  }
  return providerJson(response, maxBytes);
}

export async function freshGoogleConnection(connection: GoogleConnection, config: GoogleOAuthConfig, fetcher: typeof fetch = fetch, now = Date.now()): Promise<GoogleConnection> {
  if (connection.tokens.obtainedAt + connection.tokens.expires_in * 1000 > now + 60_000) return connection;
  if (!connection.tokens.refresh_token) throw new Error("Google access expired. Reconnect to continue.");
  const response = await providerFetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: connection.tokens.refresh_token, grant_type: "refresh_token" }) }, fetcher);
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error("Google access could not be refreshed. Reconnect to continue."); }
  const parsed = z.object({ access_token: z.string().min(1).max(16_384), expires_in: z.number().int().positive().max(604_800), token_type: z.literal("Bearer"), scope: z.string().min(1).max(16_384).optional(), refresh_token: z.string().min(1).max(16_384).optional() }).parse(await providerJson(response, 64 * 1024));
  const refreshed = GoogleConnectionSchema.parse({ features: connection.features, tokens: { ...connection.tokens, ...parsed, scope: parsed.scope ?? connection.tokens.scope, refresh_token: parsed.refresh_token ?? connection.tokens.refresh_token, obtainedAt: now } });
  for (const feature of refreshed.features) requireGoogleFeature(refreshed, feature);
  return refreshed;
}

type MessagePart = { mimeType?: string; body?: { data?: string }; parts?: MessagePart[]; headers?: { name: string; value: string }[] };
function plainParts(part: MessagePart, depth = 0, budget = { parts: 0 }): string {
  budget.parts += 1;
  if (depth > 5 || (part.parts?.length ?? 0) > 30 || budget.parts > 100) throw new Error("Google message exceeds the supported MIME nesting limit.");
  if (part.mimeType === "text/plain" && part.body?.data) {
    if (part.body.data.length > 200_000 || !/^[A-Za-z0-9_-]+={0,2}$/.test(part.body.data)) throw new Error("Google message exceeds the text budget or has invalid encoding.");
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(part.body.data, "base64url"));
  }
  return (part.parts ?? []).map((child) => plainParts(child, depth + 1, budget)).filter(Boolean).join("\n");
}
export type GoogleJobAlert = { id: string; subject: string; from: string; text: string };
export async function readGoogleJobAlerts(connection: GoogleConnection, query: string, fetcher: typeof fetch = fetch): Promise<GoogleJobAlert[]> {
  requireGoogleFeature(connection, "email_alerts");
  const selected = z.string().trim().min(1).max(300).parse(query);
  const params = new URLSearchParams({ q: selected, maxResults: "10" });
  const listed = z.object({ messages: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })).max(10).optional() }).parse(await jsonRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, connection.tokens, {}, fetcher));
  const alerts: GoogleJobAlert[] = [];
  for (const message of listed.messages ?? []) {
    const value = z.object({ id: z.string(), payload: z.object({}).passthrough() }).parse(await jsonRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=full`, connection.tokens, {}, fetcher));
    if (value.id !== message.id) throw new Error("Google returned a message for a different identifier.");
    const payload = value.payload as MessagePart;
    const header = (name: string) => (payload.headers ?? []).find((item) => item.name.toLowerCase() === name)?.value ?? "";
    const text = plainParts(payload);
    if (text.length > 100_000) throw new Error("Google message exceeds the text budget.");
    alerts.push({ id: value.id, subject: header("subject").slice(0, 500), from: header("from").slice(0, 500), text });
  }
  return alerts;
}

export async function executeGoogleWrite(connection: GoogleConnection, actionInput: GoogleWriteAction, approvalId: string, fetcher: typeof fetch = fetch) {
  const action = GoogleWriteActionSchema.parse(actionInput);
  z.string().uuid().parse(approvalId);
  requireGoogleFeature(connection, featureFor(action));
  if (action.type === "calendar_event") {
    const id = approvalId.replaceAll("-", "");
    const endpoint = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    const event = { id, summary: action.title, description: action.description, start: { dateTime: action.start }, end: { dateTime: action.end }, visibility: "private", reminders: { useDefault: false, overrides: [{ method: "popup", minutes: action.reminderMinutes }] } };
    const created = z.object({ id: z.string() }).parse(await jsonRequest(`${endpoint}?sendUpdates=none`, connection.tokens, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) }, fetcher, 64 * 1024));
    if (created.id !== id) throw new Error("Google returned a different event identifier. Check Calendar before retrying.");
    const received = z.object({ id: z.string(), summary: z.string(), description: z.string().optional(), start: z.object({ dateTime: z.string() }), end: z.object({ dateTime: z.string() }), attendees: z.array(z.unknown()).optional(), reminders: z.object({ useDefault: z.boolean(), overrides: z.array(z.object({ method: z.string(), minutes: z.number() })) }) }).parse(await jsonRequest(`${endpoint}/${id}`, connection.tokens, {}, fetcher, 64 * 1024));
    if (received.id !== id || received.summary !== action.title || (received.description ?? "") !== action.description || Date.parse(received.start.dateTime) !== Date.parse(action.start) || Date.parse(received.end.dateTime) !== Date.parse(action.end) || (received.attendees?.length ?? 0) !== 0 || received.reminders.useDefault || received.reminders.overrides.length !== 1 || received.reminders.overrides[0].method !== "popup" || received.reminders.overrides[0].minutes !== action.reminderMinutes) throw new Error("Calendar read-back did not match the reviewed event. Check Calendar before retrying.");
    return { type: action.type, providerId: id, verified: true, link: "https://calendar.google.com/calendar/u/0/r" };
  }
  // RFC 2047 encoded words are capped at 75 ASCII characters. Split only on
  // Unicode code-point boundaries and fold between encoded words.
  const chunks: string[] = []; let chunk = "";
  for (const char of action.subject) {
    if (Buffer.byteLength(chunk + char, "utf8") > 45) { chunks.push(chunk); chunk = ""; }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  const subject = chunks.map((value) => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`).join("\r\n ");
  const raw = `To: ${action.to}\r\nSubject: ${subject}\r\nX-Resume-Foundry-Approval: ${approvalId}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(action.body).toString("base64")}`;
  const endpoint = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
  const created = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).parse(await jsonRequest(endpoint, connection.tokens, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: { raw: Buffer.from(raw).toString("base64url") } }) }, fetcher, 64 * 1024));
  const received = z.object({ id: z.string(), message: z.object({ raw: z.string().max(20_000) }) }).parse(await jsonRequest(`${endpoint}/${encodeURIComponent(created.id)}?format=raw`, connection.tokens, {}, fetcher, 64 * 1024));
  const readBack = Buffer.from(received.message.raw, "base64url").toString("utf8");
  const [headerBlock, ...bodyParts] = readBack.split("\r\n\r\n");
  const headers = new Map<string, string[]>();
  for (const line of headerBlock.replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error("Gmail read-back contained malformed MIME headers.");
    const name = line.slice(0, separator).toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), line.slice(separator + 1).trim()]);
  }
  const exactHeader = (name: string, value: string) => headers.get(name)?.length === 1 && headers.get(name)?.[0] === value;
  if (received.id !== created.id || !exactHeader("to", action.to) || !exactHeader("subject", subject.replace(/\r\n /g, " ")) || !exactHeader("x-resume-foundry-approval", approvalId) || headers.has("cc") || headers.has("bcc") || !exactHeader("content-transfer-encoding", "base64") || Buffer.from(bodyParts.join("\r\n\r\n").replace(/\s/g, ""), "base64").toString("utf8") !== action.body) throw new Error("Gmail read-back did not match the reviewed draft. Check Drafts before retrying.");
  return { type: action.type, providerId: created.id, verified: true, sent: false, link: "https://mail.google.com/mail/u/0/#drafts" };
}
