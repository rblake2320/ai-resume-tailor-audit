import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonical-json";
import { protectPii } from "./pii";

export const SubmissionProviderSchema = z.enum(["greenhouse", "lever", "gmail"]);

const PROVIDER_TOKEN = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Where the submission goes and what routes it.
 *
 * This used to be read from the unsigned request body, so a receipt approved
 * for one board could be replayed to submit to a different board and job.
 * Routing is part of what the applicant approves, so it lives inside the
 * signed preview.
 */
export const SubmissionTargetSchema = z.discriminatedUnion("provider", [
  z.strictObject({ provider: z.literal("greenhouse"), boardToken: z.string().regex(PROVIDER_TOKEN), jobId: z.string().regex(PROVIDER_TOKEN) }),
  z.strictObject({ provider: z.literal("lever"), site: z.string().regex(PROVIDER_TOKEN), postingId: z.string().regex(PROVIDER_TOKEN), requiredFields: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ provider: z.literal("gmail"), rawMessage: z.string().min(1).max(5_000_000) }),
]);
export type SubmissionTarget = z.infer<typeof SubmissionTargetSchema>;

/**
 * The canonical human-facing destination for a signed target.
 *
 * `destination` is what the applicant reads; `target` is what the machine acts
 * on. Left independent, a preview could display an approved employer while the
 * signed target routed somewhere else entirely — the human approves one thing
 * and the request goes to another. Deriving it makes that divergence
 * unrepresentable.
 */
export function submissionDestination(target: SubmissionTarget): string {
  switch (target.provider) {
    case "greenhouse": return `https://boards.greenhouse.io/${target.boardToken}/jobs/${target.jobId}`;
    case "lever": return `https://jobs.lever.co/${target.site}/${target.postingId}`;
    case "gmail": return "https://mail.google.com/mail/u/0/#drafts";
  }
}

/**
 * What a field *is*, independent of whether its value matches a pattern.
 *
 * Pattern matching alone is not a consent record: `name: "Ada Lovelace"`,
 * a résumé, and a cover letter contain no email or SSN shape, so a regex-only
 * derivation reported zero categories while transmitting the applicant's legal
 * name and full employment history. Field semantics are the primary signal;
 * `protectPii` then adds identifiers that appear inside free text.
 */
const FIELD_CATEGORIES: ReadonlyArray<{ category: string; match: RegExp }> = [
  { category: "name", match: /^(?:name|first_name|last_name|middle_name|full_name|preferred_name|legal_name)$/u },
  { category: "email", match: /^(?:email|email_address)$/u },
  { category: "phone", match: /^(?:phone|phone_number|telephone|mobile)$/u },
  { category: "street address", match: /^(?:address|street_address|address_line_?\d*|city|region|postal_code|zip)$/u },
  { category: "web profile", match: /^(?:website|linkedin|github|portfolio|url)$/u },
  { category: "resume", match: /^(?:resume|resume_text|resume_content|cv|cv_text)$/u },
  { category: "cover letter", match: /^(?:cover_letter|cover_letter_text|coverletter|letter)$/u },
  { category: "written responses", match: /^(?:question_.*|screening.*|answers?)$/u },
  { category: "message body", match: /^(?:raw_?message|message|body)$/u },
];

const normaliseFieldName = (key: string) => key.trim().toLowerCase().replace(/[\s-]+/gu, "_");

/**
 * The personal-data categories actually leaving the app for a submission.
 *
 * Covers both the provider fields and, for Gmail, the drafted message body —
 * which is the entire payload for that provider and was previously not
 * considered at all.
 */
export function outgoingDataCategories(fields: Record<string, unknown>, target?: SubmissionTarget): string[] {
  const categories = new Set<string>();
  const freeText: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    freeText.push(value);
    const name = normaliseFieldName(key);
    const matched = FIELD_CATEGORIES.filter(({ match }) => match.test(name));
    for (const { category } of matched) categories.add(category);
    // Employers define arbitrary field names, so a fixed list can never be
    // exhaustive. An unrecognised field still carries applicant-authored text,
    // and under-declaring a disclosure is worse than over-declaring one.
    if (matched.length === 0) categories.add("written responses");
  }

  if (target?.provider === "gmail") {
    categories.add("message body");
    freeText.push(target.rawMessage);
  }

  for (const match of protectPii(freeText.join("\n")).matches) categories.add(match.kind);
  return [...categories].sort();
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

export const SubmissionPreviewSchema = z.strictObject({
  applicationId: z.string().min(1), provider: SubmissionProviderSchema, company: z.string().min(1), role: z.string().min(1),
  destination: z.string().url(), packetVersion: z.number().int().positive(), resumeChecksum: z.string().regex(SHA256_HEX),
  coverLetterChecksum: z.string().regex(SHA256_HEX),
  /** Binds the exact frozen packet the applicant reviewed. */
  packetChecksum: z.string().regex(SHA256_HEX),
  personalDataCategories: z.array(z.string()),
  fields: z.record(z.string(), z.unknown()), createdAt: z.string().datetime(),
  target: SubmissionTargetSchema,
}).superRefine((value, context) => {
  if (value.target.provider !== value.provider) {
    context.addIssue({ code: "custom", message: "Approved target provider must match the preview provider." });
    return;
  }
  // The displayed destination must be the one the signed target routes to.
  const expected = submissionDestination(value.target);
  if (value.destination !== expected) {
    context.addIssue({ code: "custom", message: `Displayed destination must match the signed target (${expected}).` });
  }
  // Declared personal-data categories must be the ones actually being sent, so
  // the disclosure the applicant consents to is the disclosure that happens.
  const actual = outgoingDataCategories(value.fields, value.target);
  const declared = [...new Set(value.personalDataCategories)].sort();
  if (declared.join("|") !== actual.join("|")) {
    context.addIssue({ code: "custom", message: `Declared personal-data categories must match the outgoing fields (${actual.join(", ") || "none"}).` });
  }
});
export type SubmissionPreview = z.infer<typeof SubmissionPreviewSchema>;

const APPROVAL_TTL_MS = 10 * 60_000;

export const ApprovalReceiptSchema = z.strictObject({
  preview: SubmissionPreviewSchema,
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(8).max(200),
  signature: z.string().min(1),
});
export type ApprovalReceipt = z.infer<typeof ApprovalReceiptSchema>;

const mac = (unsigned: unknown, secret: string) => createHmac("sha256", secret).update(canonicalJson(unsigned)).digest();

export function issueSubmissionApproval(preview: SubmissionPreview, secret: string, now = new Date()): ApprovalReceipt {
  if (secret.length < 24) throw new Error("Submission approval secret must be at least 24 characters.");
  const unsigned = {
    preview: SubmissionPreviewSchema.parse(preview),
    approvedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    nonce: randomUUID(),
  };
  return { ...unsigned, signature: mac(unsigned, secret).toString("base64url") };
}

/**
 * Returns the approved preview, or throws. Everything transmitted downstream
 * must be read from this return value, never from the caller's request body.
 */
export function verifySubmissionApproval(receipt: unknown, secret: string, now = new Date()): SubmissionPreview {
  // Parse before comparing: a malformed `expiresAt` previously reached
  // `new Date(...)`, produced NaN, and `NaN <= now` is false — so a receipt
  // with `expiresAt: "not-a-date"` never expired.
  const parsed = ApprovalReceiptSchema.safeParse(receipt);
  if (!parsed.success) throw new Error("Submission approval is invalid or expired.");
  const { signature, ...unsigned } = parsed.data;
  const expected = mac(unsigned, secret);
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Submission approval is invalid or expired.");

  const expiresAt = Date.parse(parsed.data.expiresAt);
  const approvedAt = Date.parse(parsed.data.approvedAt);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(approvedAt)) throw new Error("Submission approval is invalid or expired.");
  if (expiresAt <= now.getTime()) throw new Error("Submission approval is invalid or expired.");
  // Holding the signing key must not buy a longer window than the policy.
  if (expiresAt - approvedAt > APPROVAL_TTL_MS) throw new Error("Submission approval is invalid or expired.");
  return parsed.data.preview;
}

/**
 * The subset of an application packet a submission must agree with. Structural
 * so this module stays independent of the applications module.
 */
export interface ApprovablePacket {
  id: string;
  version: number;
  checksums: { packet: string; resume: string; coverLetter: string };
  jobSnapshot: { company: string; title: string };
}

/**
 * Throws unless the packet presented for transmission is the exact packet the
 * applicant approved — including the identity and the employer name and role
 * they read on screen, not only the content digests.
 *
 * Callers must additionally run `verifyApplicationPacket` so a self-consistent
 * but forged packet cannot satisfy this by carrying matching checksums of its
 * own tampered content.
 */
export function assertApprovedPacket(preview: SubmissionPreview, packet: ApprovablePacket) {
  const mismatched = [
    preview.packetChecksum !== packet.checksums.packet && "packet",
    preview.resumeChecksum !== packet.checksums.resume && "resume",
    preview.coverLetterChecksum !== packet.checksums.coverLetter && "cover letter",
    preview.applicationId !== packet.id && "application id",
    preview.packetVersion !== packet.version && "packet version",
    preview.company !== packet.jobSnapshot.company && "company",
    preview.role !== packet.jobSnapshot.title && "role",
  ].filter(Boolean);
  if (mismatched.length) throw new Error(`Submission packet does not match the approved packet (${mismatched.join(", ")}).`);
}

type Fetcher = typeof fetch;
async function retryRequest(url: string, init: RequestInit, fetcher: Fetcher, attempts = 3): Promise<Response> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetcher(url, init); if (response.ok) return response;
    if (response.status !== 429 || attempt === attempts - 1) throw new Error(`Submission connector rejected the request (${response.status}).`);
    const delay = Math.min(Number(response.headers.get("retry-after") ?? "1") || 1, 5); await new Promise((resolve) => setTimeout(resolve, delay * 1000));
  }
  throw new Error("Submission retry budget exhausted.");
}

type GreenhouseQuestion = { required?: boolean; fields?: { name?: string; type?: string }[] };
export async function greenhouseRequiredFields(boardToken: string, jobId: string, fetcher: Fetcher = fetch): Promise<string[]> {
  const response = await retryRequest(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobId)}?questions=true`, {}, fetcher);
  const job = await response.json() as { questions?: GreenhouseQuestion[]; location_questions?: GreenhouseQuestion[]; data_compliance?: { requires_consent?: boolean }[] };
  const required = [...(job.questions ?? []), ...(job.location_questions ?? [])].filter((question) => question.required).flatMap((question) => question.fields ?? []).map((field) => field.name).filter((name): name is string => Boolean(name));
  if ((job.data_compliance ?? []).some((item) => item.requires_consent)) required.push("data_compliance");
  return [...new Set(["first_name", "last_name", "email", ...required])];
}

function validateFields(fields: Record<string, unknown>, required: readonly string[]) {
  const missing = required.filter((name) => fields[name] === undefined || fields[name] === null || fields[name] === "");
  if (missing.length) throw new Error(`Required submission fields are missing: ${missing.join(", ")}.`);
  for (const name of ["first_name", "last_name", "name", "email"]) if (fields[name] !== undefined && (typeof fields[name] !== "string" || fields[name].length > 255)) throw new Error(`${name} must be a string no longer than 255 characters.`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(String(fields.email))) throw new Error("email must be valid.");
}

/**
 * Every connector below takes only a receipt plus deployment credentials.
 *
 * There is deliberately no `fields`, `boardToken`, `jobId`, `site`,
 * `postingId`, or `rawMessage` parameter: routing and content are read from the
 * verified preview, so a caller cannot substitute anything the applicant did
 * not approve. That substitution was the original defect — the receipt verified
 * while the request body supplied a different board and a different résumé.
 */
export async function submitGreenhouse(input: { apiKey: string; receipt: unknown; approvalSecret: string }, fetcher: Fetcher = fetch) {
  const preview = verifySubmissionApproval(input.receipt, input.approvalSecret);
  if (preview.target.provider !== "greenhouse") throw new Error("Approval provider mismatch.");
  const { boardToken, jobId } = preview.target;
  const required = await greenhouseRequiredFields(boardToken, jobId, fetcher);
  validateFields(preview.fields, required);
  const response = await retryRequest(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobId)}`,
    { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${input.apiKey}:`).toString("base64")}`, "content-type": "application/json" }, body: JSON.stringify(preview.fields) }, fetcher);
  return { provider: "greenhouse" as const, accepted: true, status: response.status, applicationId: preview.applicationId };
}

export async function submitLever(input: { apiKey: string; receipt: unknown; approvalSecret: string }, fetcher: Fetcher = fetch) {
  const preview = verifySubmissionApproval(input.receipt, input.approvalSecret);
  if (preview.target.provider !== "lever") throw new Error("Approval provider mismatch.");
  const { site, postingId, requiredFields } = preview.target;
  validateFields(preview.fields, [...new Set(["name", "email", ...requiredFields])]);
  // The key stays in a header: a query-string credential lands in provider
  // access logs, proxy logs, and any telemetry that records request URLs.
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}/${encodeURIComponent(postingId)}`;
  const response = await retryRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${input.apiKey}:`).toString("base64")}` },
    body: JSON.stringify(preview.fields),
  }, fetcher);
  return { provider: "lever" as const, accepted: true, status: response.status, applicationId: preview.applicationId };
}

export async function createGmailDraft(input: { accessToken: string; receipt: unknown; approvalSecret: string }, fetcher: Fetcher = fetch) {
  const preview = verifySubmissionApproval(input.receipt, input.approvalSecret);
  if (preview.target.provider !== "gmail") throw new Error("Approval provider mismatch.");
  const raw = Buffer.from(preview.target.rawMessage, "utf8").toString("base64url");
  const response = await retryRequest("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ message: { raw } }) }, fetcher);
  const body = await response.json() as { id?: string }; if (!body.id) throw new Error("Gmail did not return a draft identifier.");
  return { provider: "gmail" as const, draftId: body.id, sent: false, applicationId: preview.applicationId };
}
