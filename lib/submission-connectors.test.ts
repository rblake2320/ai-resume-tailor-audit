import { describe, expect, it, vi } from "vitest";
import { assertApprovedPacket, createGmailDraft, greenhouseRequiredFields, issueSubmissionApproval, submitGreenhouse, submitLever, verifySubmissionApproval, type SubmissionPreview, type SubmissionTarget } from "./submission-connectors";

const secret = "this-is-a-human-approval-secret";

const targets: Record<SubmissionPreview["provider"], SubmissionTarget> = {
  greenhouse: { provider: "greenhouse", boardToken: "approved-board", jobId: "111" },
  lever: { provider: "lever", site: "approved-site", postingId: "222", requiredFields: ["name"] },
  gmail: { provider: "gmail", rawMessage: "To: jobs@example.com\r\nSubject: Application\r\n\r\nHello" },
};

const preview = (provider: "greenhouse" | "lever" | "gmail"): SubmissionPreview => ({
  applicationId: "app-1", provider, company: "Acme", role: "Engineer",
  destination: "https://example.com/apply", packetVersion: 2,
  resumeChecksum: "a".repeat(64), coverLetterChecksum: "b".repeat(64), packetChecksum: "c".repeat(64),
  personalDataCategories: ["email"],
  fields: { first_name: "Ada", last_name: "Lovelace", name: "Ada Lovelace", email: "ada@example.com", resume_text: "APPROVED RESUME" },
  createdAt: "2026-01-01T00:00:00.000Z", target: structuredClone(targets[provider]),
});

describe("authorized submission connectors", () => {
  it("binds approval to the exact preview and rejects mutation or expiry", () => {
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret, new Date("2026-01-01T00:00:00Z"));
    expect(verifySubmissionApproval(receipt, secret, new Date("2026-01-01T00:01:00Z"))).toEqual(preview("greenhouse"));
    const tampered = structuredClone(receipt); tampered.preview.role = "Different";
    expect(() => verifySubmissionApproval(tampered, secret, new Date("2026-01-01T00:01:00Z"))).toThrow(/invalid/);
    expect(() => verifySubmissionApproval(receipt, secret, new Date("2026-01-01T00:11:00Z"))).toThrow(/invalid or expired/);
  });

  it("transmits only the approved destination and the approved fields", async () => {
    // Regression for the central defect: the execute route passed boardToken,
    // jobId, and fields straight from the unsigned request body, so a receipt
    // approved for one board was accepted while an entirely different résumé
    // was POSTed to an entirely different board — returning accepted: true with
    // the approved applicationId. The connector now exposes no parameter
    // through which that substitution can be expressed.
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ questions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect((await submitGreenhouse({ apiKey: "server-secret", receipt, approvalSecret: secret }, fetcher)).accepted).toBe(true);

    const post = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("https://boards-api.greenhouse.io/v1/boards/approved-board/jobs/111");
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual(preview("greenhouse").fields);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("server-secret");
  });

  it("rejects a receipt whose expiresAt is malformed instead of treating it as eternal", () => {
    // Regression: `new Date("not-a-date") <= now` is false, so a receipt with a
    // malformed expiresAt never expired. expiresAt is inside the MAC, so this
    // was reachable by anyone holding the signing key — which every caller of
    // the approval endpoint necessarily does.
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret);
    for (const bad of ["not-a-date", "", "9999-99-99T00:00:00Z"]) {
      expect(() => verifySubmissionApproval({ ...structuredClone(receipt), expiresAt: bad }, secret, new Date("2099-01-01T00:00:00Z")))
        .toThrow(/invalid or expired/);
    }
  });

  it("rejects a validly signed receipt that grants itself a longer window than policy", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret, now);
    // Same secret, but a year-long window rather than the ten-minute policy.
    const forged = { preview: receipt.preview, approvedAt: receipt.approvedAt, expiresAt: "2027-01-01T00:00:00.000Z", nonce: receipt.nonce };
    const signature = issueSubmissionApproval(preview("greenhouse"), secret, now).signature;
    expect(() => verifySubmissionApproval({ ...forged, signature }, secret, now)).toThrow(/invalid or expired/);
  });

  it("verifies regardless of JSON key order", () => {
    // The MAC covered JSON.stringify(unsigned), which preserves insertion
    // order, so any client that rebuilt the object failed verification in a way
    // indistinguishable from tampering.
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret, new Date("2026-01-01T00:00:00Z"));
    const reordered = JSON.parse(JSON.stringify({
      signature: receipt.signature, nonce: receipt.nonce, expiresAt: receipt.expiresAt,
      approvedAt: receipt.approvedAt, preview: receipt.preview,
    }));
    expect(verifySubmissionApproval(reordered, secret, new Date("2026-01-01T00:01:00Z")).applicationId).toBe("app-1");
  });

  it("refuses to issue a receipt whose signed target disagrees with the preview provider", () => {
    const mismatched = { ...preview("greenhouse"), target: structuredClone(targets.lever) } as unknown as SubmissionPreview;
    expect(() => issueSubmissionApproval(mismatched, secret)).toThrow();
  });

  it("binds the exact frozen packet, résumé, and cover letter", () => {
    const approved = preview("greenhouse");
    const good = { packet: "c".repeat(64), resume: "a".repeat(64), coverLetter: "b".repeat(64) };
    expect(() => assertApprovedPacket(approved, good)).not.toThrow();
    expect(() => assertApprovedPacket(approved, { ...good, packet: "d".repeat(64) })).toThrow(/packet/);
    expect(() => assertApprovedPacket(approved, { ...good, resume: "d".repeat(64) })).toThrow(/resume/);
    expect(() => assertApprovedPacket(approved, { ...good, coverLetter: "d".repeat(64) })).toThrow(/cover letter/);
  });

  it("discovers and enforces Greenhouse job-specific required fields before submit", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ questions: [{ required: true, fields: [{ name: "question_1" }] }] }), { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await greenhouseRequiredFields("board", "1", fetcher)).toContain("question_1");
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret);
    const missingFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ questions: [{ required: true, fields: [{ name: "question_1" }] }] }), { status: 200 }));
    await expect(submitGreenhouse({ apiKey: "server-secret", receipt, approvalSecret: secret }, missingFetcher)).rejects.toThrow(/question_1/);
    expect(missingFetcher).toHaveBeenCalledTimes(1);
  });

  it("retries rate-limited Greenhouse submission without exposing its server credential", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ questions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "retry-after": "0.001" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const receipt = issueSubmissionApproval(preview("greenhouse"), secret);
    expect((await submitGreenhouse({ apiKey: "server-secret", receipt, approvalSecret: secret }, fetcher)).accepted).toBe(true);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("server-secret");
    expect((fetcher.mock.calls[1][1] as RequestInit).headers).toHaveProperty("authorization");
  });

  it("keeps the Lever credential out of the request URL", async () => {
    // Regression: the key was interpolated as ?key=..., so it landed in
    // provider access logs, proxy logs, and any telemetry recording URLs.
    const receipt = issueSubmissionApproval(preview("lever"), secret);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await submitLever({ apiKey: "lever-secret", receipt, approvalSecret: secret }, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.lever.co/v0/postings/approved-site/222");
    expect(String(fetcher.mock.calls[0][0])).not.toContain("lever-secret");
    expect((fetcher.mock.calls[0][1] as RequestInit).headers).toHaveProperty("authorization");
  });

  it("requires employer-provided Lever required-field configuration", () => {
    const withoutRequired = { ...preview("lever"), target: { ...targets.lever, requiredFields: [] } } as unknown as SubmissionPreview;
    expect(() => issueSubmissionApproval(withoutRequired, secret)).toThrow();
  });

  it("creates a Gmail draft but never sends it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "draft-1" }), { status: 200 }));
    const result = await createGmailDraft({ accessToken: "token", receipt: issueSubmissionApproval(preview("gmail"), secret), approvalSecret: secret }, fetcher);
    expect(result).toMatchObject({ draftId: "draft-1", sent: false });
    expect(fetcher.mock.calls[0][0]).toContain("/drafts");
    expect(fetcher.mock.calls[0][0]).not.toContain("send");
  });

  it("refuses a receipt aimed at a different provider", async () => {
    const receipt = issueSubmissionApproval(preview("lever"), secret);
    await expect(submitGreenhouse({ apiKey: "k", receipt, approvalSecret: secret }, vi.fn())).rejects.toThrow(/provider mismatch/i);
  });
});
