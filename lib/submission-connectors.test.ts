import { describe, expect, it, vi } from "vitest";
import { createGmailDraft, greenhouseRequiredFields, issueSubmissionApproval, submitGreenhouse, submitLever, verifySubmissionApproval, type SubmissionPreview } from "./submission-connectors";

const secret = "this-is-a-human-approval-secret";
const preview = (provider: "greenhouse" | "lever" | "gmail"): SubmissionPreview => ({ applicationId: "app-1", provider, company: "Acme", role: "Engineer", destination: "https://example.com/apply", packetVersion: 2, resumeChecksum: "a".repeat(64), coverLetterChecksum: "b".repeat(64), personalDataCategories: ["email"], fields: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" }, createdAt: "2026-01-01T00:00:00.000Z" });
describe("authorized submission connectors", () => {
  it("binds approval to exact preview and rejects mutation or expiry", () => {
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret, new Date("2026-01-01T00:00:00Z"));
    expect(verifySubmissionApproval(receipt, secret, new Date("2026-01-01T00:01:00Z"))).toEqual(preview("greenhouse"));
    const tampered = structuredClone(receipt); tampered.preview.role = "Different";
    expect(() => verifySubmissionApproval(tampered, secret, new Date("2026-01-01T00:01:00Z"))).toThrow(/invalid/);
    expect(() => verifySubmissionApproval(receipt, secret, new Date("2026-01-01T00:11:00Z"))).toThrow(/expired/);
  });
  it("discovers and enforces Greenhouse job-specific required fields before submit", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ questions: [{ required: true, fields: [{ name: "question_1" }] }] }), { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await greenhouseRequiredFields("board", "1", fetcher)).toContain("question_1");
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret);
    const missingFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ questions: [{ required: true, fields: [{ name: "question_1" }] }] }), { status: 200 }));
    await expect(submitGreenhouse({ boardToken: "board", jobId: "1", apiKey: "server-secret", fields: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" }, receipt, approvalSecret: secret }, missingFetcher)).rejects.toThrow(/question_1/);
    expect(missingFetcher).toHaveBeenCalledTimes(1);
  });
  it("retries rate-limited Greenhouse submission without exposing its server credential", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ questions: [] }), { status: 200 })).mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "retry-after": "0.001" } })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret);
    expect((await submitGreenhouse({ boardToken: "board", jobId: "1", apiKey: "server-secret", fields: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" }, receipt, approvalSecret: secret }, fetcher)).accepted).toBe(true);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("server-secret");
    expect((fetcher.mock.calls[1][1] as RequestInit).headers).toHaveProperty("authorization");
  });
  it("requires employer-provided Lever required-field configuration", async () => {
    const receipt = issueSubmissionApproval(preview("lever"), secret);
    await expect(submitLever({ site: "site", postingId: "post", apiKey: "key", requiredFields: [], fields: {}, receipt, approvalSecret: secret }, vi.fn())).rejects.toThrow(/Employer-provided/);
  });
  it("creates a Gmail draft but never sends it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "draft-1" }), { status: 200 }));
    const result = await createGmailDraft({ accessToken: "token", rawMessage: "To: jobs@example.com\r\nSubject: Application\r\n\r\nHello", receipt: issueSubmissionApproval(preview("gmail"), secret), approvalSecret: secret }, fetcher);
    expect(result).toMatchObject({ draftId: "draft-1", sent: false }); expect(fetcher.mock.calls[0][0]).toContain("/drafts"); expect(fetcher.mock.calls[0][0]).not.toContain("send");
  });
});
