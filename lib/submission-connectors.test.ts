import { describe, expect, it, vi } from "vitest";
import { assertApprovedPacket, createGmailDraft, greenhouseRequiredFields, issueSubmissionApproval, outgoingDataCategories, submissionDestination, submitGreenhouse, submitLever, verifySubmissionApproval, type ApprovablePacket, type SubmissionPreview, type SubmissionTarget } from "./submission-connectors";

const secret = "this-is-a-human-approval-secret";

const targets: Record<SubmissionPreview["provider"], SubmissionTarget> = {
  greenhouse: { provider: "greenhouse", boardToken: "approved-board", jobId: "111" },
  lever: { provider: "lever", site: "approved-site", postingId: "222", requiredFields: ["name"] },
  gmail: { provider: "gmail", rawMessage: "To: jobs@example.com\r\nSubject: Application\r\n\r\nHello" },
};

const preview = (provider: "greenhouse" | "lever" | "gmail"): SubmissionPreview => ({
  applicationId: "app-1", provider, company: "Acme", role: "Engineer",
  destination: submissionDestination(targets[provider]), packetVersion: 2,
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

  it("binds the packet identity, version, employer, role, and content digests", () => {
    const approved = preview("greenhouse");
    const packet: ApprovablePacket = {
      id: "app-1", version: 2,
      checksums: { packet: "c".repeat(64), resume: "a".repeat(64), coverLetter: "b".repeat(64) },
      jobSnapshot: { company: "Acme", title: "Engineer" },
    };
    expect(() => assertApprovedPacket(approved, packet)).not.toThrow();

    const mutate = (patch: Partial<ApprovablePacket>) => ({ ...structuredClone(packet), ...patch });
    expect(() => assertApprovedPacket(approved, mutate({ checksums: { ...packet.checksums, packet: "d".repeat(64) } }))).toThrow(/packet/);
    expect(() => assertApprovedPacket(approved, mutate({ checksums: { ...packet.checksums, resume: "d".repeat(64) } }))).toThrow(/resume/);
    expect(() => assertApprovedPacket(approved, mutate({ checksums: { ...packet.checksums, coverLetter: "d".repeat(64) } }))).toThrow(/cover letter/);
    // A digest-identical packet from a different application, version, or
    // employer must still be refused: the applicant approved a specific
    // application for a specific employer and role, not just some bytes.
    expect(() => assertApprovedPacket(approved, mutate({ id: "app-2" }))).toThrow(/application id/);
    expect(() => assertApprovedPacket(approved, mutate({ version: 3 }))).toThrow(/packet version/);
    expect(() => assertApprovedPacket(approved, mutate({ jobSnapshot: { company: "Other Corp", title: "Engineer" } }))).toThrow(/company/);
    expect(() => assertApprovedPacket(approved, mutate({ jobSnapshot: { company: "Acme", title: "Manager" } }))).toThrow(/role/);
  });

  it("refuses a preview whose displayed destination is not where the target routes", () => {
    // The applicant reads `destination`; the machine acts on `target`. Left
    // independent, a preview could display an approved employer while the signed
    // target routed somewhere else entirely.
    const lying = { ...preview("greenhouse"), destination: "https://boards.greenhouse.io/trusted-employer/jobs/999" } as SubmissionPreview;
    expect(() => issueSubmissionApproval(lying, secret)).toThrow(/Displayed destination must match/);
  });

  it("refuses a preview that under-declares the personal data it will send", () => {
    const under = { ...preview("greenhouse"), personalDataCategories: [] } as SubmissionPreview;
    expect(() => issueSubmissionApproval(under, secret)).toThrow(/personal-data categories/);
    const over = { ...preview("greenhouse"), personalDataCategories: ["email", "government identifier"] } as SubmissionPreview;
    expect(() => issueSubmissionApproval(over, secret)).toThrow(/personal-data categories/);
  });

  it("derives personal-data categories from the fields actually being sent", () => {
    expect(outgoingDataCategories({ email: "ada@example.com" })).toEqual(["email"]);
    expect(outgoingDataCategories({ a: "ssn 555-00-1234", b: "ada@example.com" }).sort()).toEqual(["email", "government identifier"]);
    expect(outgoingDataCategories({ name: "Ada Lovelace" })).toEqual([]);
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
