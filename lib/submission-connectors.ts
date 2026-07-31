import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SubmissionProviderSchema = z.enum(["greenhouse", "lever", "gmail"]);
export const SubmissionPreviewSchema = z.strictObject({
  applicationId: z.string().min(1), provider: SubmissionProviderSchema, company: z.string().min(1), role: z.string().min(1),
  destination: z.string().url(), packetVersion: z.number().int().positive(), resumeChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  coverLetterChecksum: z.string().regex(/^[a-f0-9]{64}$/), personalDataCategories: z.array(z.string()),
  fields: z.record(z.string(), z.unknown()), createdAt: z.string().datetime(),
});
export type SubmissionPreview = z.infer<typeof SubmissionPreviewSchema>;

export interface ApprovalReceipt { preview: SubmissionPreview; approvedAt: string; expiresAt: string; nonce: string; signature: string }
export function issueSubmissionApproval(preview: SubmissionPreview, secret: string, now = new Date()): ApprovalReceipt {
  if (secret.length < 24) throw new Error("Submission approval secret must be at least 24 characters.");
  const expires = new Date(now.getTime() + 10 * 60_000);
  const unsigned = { preview: SubmissionPreviewSchema.parse(preview), approvedAt: now.toISOString(), expiresAt: expires.toISOString(), nonce: randomUUID() };
  return { ...unsigned, signature: createHmac("sha256", secret).update(JSON.stringify(unsigned)).digest("base64url") };
}
export function verifySubmissionApproval(receipt: ApprovalReceipt, secret: string, now = new Date()): SubmissionPreview {
  const { signature, ...unsigned } = receipt; const expected = createHmac("sha256", secret).update(JSON.stringify(unsigned)).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || new Date(receipt.expiresAt) <= now) throw new Error("Submission approval is invalid or expired.");
  return SubmissionPreviewSchema.parse(receipt.preview);
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

export async function submitGreenhouse(input: { boardToken: string; jobId: string; apiKey: string; fields: Record<string, unknown>; receipt: ApprovalReceipt; approvalSecret: string }, fetcher: Fetcher = fetch) {
  const preview = verifySubmissionApproval(input.receipt, input.approvalSecret); if (preview.provider !== "greenhouse") throw new Error("Approval provider mismatch.");
  const required = await greenhouseRequiredFields(input.boardToken, input.jobId, fetcher); validateFields(input.fields, required);
  const response = await retryRequest(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(input.boardToken)}/jobs/${encodeURIComponent(input.jobId)}`,
    { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${input.apiKey}:`).toString("base64")}`, "content-type": "application/json" }, body: JSON.stringify(input.fields) }, fetcher);
  return { provider: "greenhouse" as const, accepted: true, status: response.status, applicationId: preview.applicationId };
}

export async function submitLever(input: { site: string; postingId: string; apiKey: string; requiredFields: string[]; fields: Record<string, unknown>; receipt: ApprovalReceipt; approvalSecret: string }, fetcher: Fetcher = fetch) {
  const preview = verifySubmissionApproval(input.receipt, input.approvalSecret); if (preview.provider !== "lever") throw new Error("Approval provider mismatch.");
  if (!input.requiredFields.length) throw new Error("Employer-provided Lever required-field configuration is required.");
  validateFields(input.fields, [...new Set(["name", "email", ...input.requiredFields])]);
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(input.site)}/${encodeURIComponent(input.postingId)}?key=${encodeURIComponent(input.apiKey)}`;
  const response = await retryRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input.fields) }, fetcher);
  return { provider: "lever" as const, accepted: true, status: response.status, applicationId: preview.applicationId };
}

export async function createGmailDraft(input: { accessToken: string; rawMessage: string; receipt: ApprovalReceipt; approvalSecret: string }, fetcher: Fetcher = fetch) {
  const preview = verifySubmissionApproval(input.receipt, input.approvalSecret); if (preview.provider !== "gmail") throw new Error("Approval provider mismatch.");
  const raw = Buffer.from(input.rawMessage, "utf8").toString("base64url");
  const response = await retryRequest("https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ message: { raw } }) }, fetcher);
  const body = await response.json() as { id?: string }; if (!body.id) throw new Error("Gmail did not return a draft identifier.");
  return { provider: "gmail" as const, draftId: body.id, sent: false, applicationId: preview.applicationId };
}
