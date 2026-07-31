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
  { category: "street address", match: /^(?:address|street_address|address_line_?\d*|city|region|postal_code|zip|location)$/u },
  { category: "web profile", match: /^(?:website|linkedin|github|portfolio|url|urls|links?)$/u },
  { category: "resume", match: /^(?:resume|resume_text|resume_content|cv|cv_text)$/u },
  { category: "cover letter", match: /^(?:cover_letter|cover_letter_text|coverletter|letter)$/u },
  { category: "written responses", match: /^(?:question_.*|screening.*|answers?)$/u },
  { category: "message body", match: /^(?:raw_?message|message|body)$/u },
  { category: "government identifier", match: /^(?:ssn|social_security_number|tax_id|national_id)$/u },
  { category: "demographic information", match: /^(?:gender|sex|race|ethnicity|age|age_range|date_of_birth|dob)$/u },
  { category: "disability information", match: /^(?:disability|disability_status|disability_signature.*)$/u },
  { category: "veteran status", match: /^(?:veteran|veteran_status|military_status)$/u },
  { category: "work authorization", match: /^(?:work_authorization|visa|sponsorship|authorized_to_work)$/u },
  { category: "compensation expectations", match: /^(?:salary|salary_expectation|compensation|desired_compensation)$/u },
];

const normaliseFieldName = (key: string) => key.trim().toLowerCase().replace(/[\s-]+/gu, "_");

const MAX_FIELD_DEPTH = 6;
const MAX_FIELD_NODES = 1_000;
const MAX_FIELD_KEYS = 100;
const MAX_FIELD_KEY_CHARS = 200;
const MAX_FIELD_STRING_CHARS = 100_000;
const MAX_FIELD_TEXT_BYTES = 256_000;

class SubmissionFieldsError extends Error {}

type FieldNode = {
  value: unknown;
  key: string;
  depth: number;
  inheritedCategories: readonly string[];
};

const categoriesForKey = (key: string) => {
  const name = normaliseFieldName(key);
  return FIELD_CATEGORIES.filter(({ match }) => match.test(name)).map(({ category }) => category);
};

/**
 * Walk the exact JSON-compatible structure that connectors will transmit.
 *
 * The old classifier skipped every non-string value, so nesting a résumé or
 * answer in an object/array bypassed the consent record while JSON.stringify
 * still sent it. This walker classifies every substantive leaf and rejects
 * structures too deep or large to inspect safely and completely.
 */
function classifyOutgoingFields(fields: Record<string, unknown>) {
  const topLevel = Object.entries(fields);
  if (topLevel.length > MAX_FIELD_KEYS) throw new SubmissionFieldsError(`Submission fields may contain at most ${MAX_FIELD_KEYS} top-level keys.`);

  const categories = new Set<string>();
  const freeText: string[] = [];
  const seen = new WeakSet<object>();
  const stack: FieldNode[] = topLevel.map(([key, value]) => ({ value, key, depth: 1, inheritedCategories: [] }));
  let nodes = 0;
  let textBytes = 0;

  while (stack.length) {
    const node = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_FIELD_NODES) throw new SubmissionFieldsError(`Submission fields may contain at most ${MAX_FIELD_NODES} values.`);
    if (node.depth > MAX_FIELD_DEPTH) throw new SubmissionFieldsError(`Submission fields may be nested at most ${MAX_FIELD_DEPTH} levels.`);
    if (node.key.length < 1 || node.key.length > MAX_FIELD_KEY_CHARS) throw new SubmissionFieldsError(`Submission field names must be 1-${MAX_FIELD_KEY_CHARS} characters.`);

    let directCategories = categoriesForKey(node.key);
    // Lever's native wrappers use `location.name` for the address value and
    // `urls[].name` for the URL-question label. In those contexts `name` is
    // not the applicant's name; inheriting the container meaning is accurate
    // and avoids claiming a disclosure that is not present.
    if (normaliseFieldName(node.key) === "name"
      && node.inheritedCategories.some((category) => category === "street address" || category === "web profile")) {
      directCategories = directCategories.filter((category) => category !== "name");
    }
    const semanticCategories = [...new Set([...node.inheritedCategories, ...directCategories])];
    const leafCategories = semanticCategories.length ? semanticCategories : ["written responses"];
    const { value } = node;

    if (value === null) continue;
    if (typeof value === "string") {
      if (value.length > MAX_FIELD_STRING_CHARS) throw new SubmissionFieldsError(`Each submission field string may contain at most ${MAX_FIELD_STRING_CHARS} characters.`);
      if (value.trim() === "") continue;
      textBytes += Buffer.byteLength(value, "utf8");
      if (textBytes > MAX_FIELD_TEXT_BYTES) throw new SubmissionFieldsError(`Submission field text may contain at most ${MAX_FIELD_TEXT_BYTES} UTF-8 bytes.`);
      for (const category of leafCategories) categories.add(category);
      freeText.push(value);
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new SubmissionFieldsError("Submission field numbers must be finite.");
      for (const category of leafCategories) categories.add(category);
      continue;
    }
    if (typeof value === "boolean") {
      for (const category of leafCategories) categories.add(category);
      continue;
    }
    if (typeof value !== "object") throw new SubmissionFieldsError("Submission fields must contain only JSON-compatible values.");
    if (seen.has(value)) throw new SubmissionFieldsError("Submission fields must not contain circular references.");
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > MAX_FIELD_KEYS) throw new SubmissionFieldsError(`Submission field arrays may contain at most ${MAX_FIELD_KEYS} items.`);
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], key: node.key, depth: node.depth + 1, inheritedCategories: semanticCategories });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new SubmissionFieldsError("Submission fields must contain only plain JSON objects.");
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_FIELD_KEYS) throw new SubmissionFieldsError(`Submission field objects may contain at most ${MAX_FIELD_KEYS} keys.`);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, nested] = entries[index]!;
      stack.push({ value: nested, key, depth: node.depth + 1, inheritedCategories: semanticCategories });
    }
  }

  return { categories, freeText };
}

/**
 * The personal-data categories actually leaving the app for a submission.
 *
 * Covers both the provider fields and, for Gmail, the drafted message body —
 * which is the entire payload for that provider and was previously not
 * considered at all.
 */
export function outgoingDataCategories(fields: Record<string, unknown>, target?: SubmissionTarget): string[] {
  const { categories, freeText } = classifyOutgoingFields(fields);

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
  let actual: string[];
  try {
    actual = outgoingDataCategories(value.fields, value.target);
  } catch (error) {
    context.addIssue({ code: "custom", path: ["fields"], message: error instanceof SubmissionFieldsError ? error.message : "Submission fields are invalid." });
    return;
  }
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
  const { postingId, requiredFields } = preview.target;
  validateFields(preview.fields, [...new Set(["name", "email", ...requiredFields])]);
  // The key stays in a header: a query-string credential lands in provider
  // access logs, proxy logs, and any telemetry that records request URLs.
  // Lever's authenticated Opportunities API uses the v1 apply endpoint. The
  // public v0 postings URL (which includes the site token) is an import API,
  // not the employer-authorized submission contract.
  const url = `https://api.lever.co/v1/postings/${encodeURIComponent(postingId)}/apply`;
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
