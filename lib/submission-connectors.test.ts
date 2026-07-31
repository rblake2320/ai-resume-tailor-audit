import { describe, expect, it, vi } from "vitest";
import { assertApprovedPacket, createGmailDraft, greenhouseRequiredFields, issueSubmissionApproval, outgoingDataCategories, submissionDestination, submitGreenhouse, submitLever, verifySubmissionApproval, type ApprovablePacket, type SubmissionPreview, type SubmissionTarget } from "./submission-connectors";

const secret = "this-is-a-human-approval-secret";

const targets: Record<SubmissionPreview["provider"], SubmissionTarget> = {
  greenhouse: { provider: "greenhouse", boardToken: "approved-board", jobId: "111" },
  lever: { provider: "lever", site: "approved-site", postingId: "222", requiredFields: ["name"] },
  gmail: { provider: "gmail", rawMessage: "To: jobs@example.com\r\nSubject: Application\r\n\r\nHello" },
};

const FIELDS = { first_name: "Ada", last_name: "Lovelace", name: "Ada Lovelace", email: "ada@example.com", resume_text: "APPROVED RESUME" };

const preview = (provider: "greenhouse" | "lever" | "gmail"): SubmissionPreview => ({
  applicationId: "app-1", provider, company: "Acme", role: "Engineer",
  destination: submissionDestination(targets[provider]), packetVersion: 2,
  resumeChecksum: "a".repeat(64), coverLetterChecksum: "b".repeat(64), packetChecksum: "c".repeat(64),
  personalDataCategories: outgoingDataCategories(FIELDS, targets[provider]),
  fields: { ...FIELDS },
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

  it("derives personal-data categories from what a field IS, not only what it matches", () => {
    // Regression: derivation was regex-only, so a plain legal name, a résumé,
    // and a cover letter reported ZERO categories while being transmitted — the
    // consent record said "no personal data" about the most personal payload
    // the app sends.
    expect(outgoingDataCategories({ name: "Ada Lovelace" })).toEqual(["name"]);
    expect(outgoingDataCategories({ first_name: "Ada", last_name: "Lovelace" })).toEqual(["name"]);
    expect(outgoingDataCategories({ resume_text: "Built systems at Acme." })).toEqual(["resume"]);
    expect(outgoingDataCategories({ cover_letter: "Dear hiring manager." })).toEqual(["cover letter"]);
    expect(outgoingDataCategories({ question_12345: "I have five years." })).toEqual(["written responses"]);
    expect(outgoingDataCategories({ "Phone-Number": "n/a" })).toEqual(["phone"]);
    expect(outgoingDataCategories({ city: "Austin" })).toEqual(["street address"]);
  });

  it("still detects identifiers hiding inside free text", () => {
    expect(outgoingDataCategories({ q1: "reach me at ada@example.com" })).toEqual(["email", "written responses"]);
    expect(outgoingDataCategories({ notes: "ssn 555-00-1234" })).toEqual(["government identifier", "written responses"]);
  });

  it("counts the Gmail message body, which is that provider's entire payload", () => {
    expect(outgoingDataCategories({}, targets.gmail)).toEqual(["email", "message body"]);
  });

  it("declares an unrecognised field rather than silently omitting it", () => {
    // Employers define arbitrary field names, so under-declaring is the failure
    // mode to avoid: an unknown field still carries applicant-authored text.
    expect(outgoingDataCategories({ tell_us_about_yourself: "I build systems." })).toEqual(["written responses"]);
  });

  it("classifies nested objects and arrays before an approval can be issued", () => {
    // Regression: `fields` accepted unknown values, the connectors serialized
    // them, but the old classifier skipped every non-string top-level value.
    const fields = {
      resume_text: { sections: [{ text: "Built reliable systems." }] },
      screening: [{ email: "ada@example.com", response: "I can travel." }],
    };
    const categories = outgoingDataCategories(fields);
    expect(categories).toEqual(["email", "resume", "written responses"]);

    const nested = { ...preview("greenhouse"), fields, personalDataCategories: categories } as SubmissionPreview;
    expect(() => issueSubmissionApproval(nested, secret)).not.toThrow();
    expect(() => issueSubmissionApproval({ ...nested, personalDataCategories: ["resume"] }, secret))
      .toThrow(/personal-data categories/);
  });

  it("derives location and web-profile consent from Lever's native nested field shape", () => {
    // Current Lever Apply-to-a-posting requests carry URL answers as an array
    // of {name,value} objects. These values used to fall through as generic
    // written responses; `location` was generic too. The inherited semantic
    // category must survive the array/object wrappers.
    const fields = {
      location: { name: "Austin, TX" },
      urls: [
        { name: "LinkedIn", value: "https://www.linkedin.com/in/ada" },
        { name: "Github", value: "https://github.com/ada" },
      ],
    };
    expect(outgoingDataCategories(fields)).toEqual(["street address", "web profile"]);

    const candidate = {
      ...preview("lever"),
      fields: { ...preview("lever").fields, ...fields },
    };
    candidate.personalDataCategories = outgoingDataCategories(candidate.fields, candidate.target);
    expect(() => issueSubmissionApproval(candidate, secret)).not.toThrow();
    expect(() => issueSubmissionApproval({ ...candidate, personalDataCategories: ["email", "name"] }, secret))
      .toThrow(/personal-data categories/);
  });

  it("names sensitive nested application categories rather than hiding them as generic text", () => {
    expect(outgoingDataCategories({
      eeoResponses: { gender: "Female", race: "Prefer not to say", veteran: "No", disability: "No" },
      work_authorization: true,
      salary_expectation: 100_000,
    })).toEqual([
      "compensation expectations",
      "demographic information",
      "disability information",
      "veteran status",
      "work authorization",
    ]);
  });

  it("bounds and validates every recursively transmitted field value", () => {
    let tooDeep: unknown = "private answer";
    for (let index = 0; index < 7; index += 1) tooDeep = { nested: tooDeep };
    for (const fields of [
      { response: tooDeep },
      { response: Number.NaN },
      { response: new Date() },
      { response: Array.from({ length: 101 }, () => "answer") },
      Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field_${index}`, "answer"])),
    ]) {
      const candidate = { ...preview("greenhouse"), fields, personalDataCategories: ["written responses"] };
      expect(() => issueSubmissionApproval(candidate as SubmissionPreview, secret)).toThrow(/Submission field|Submission fields/);
    }
  });

  it("ignores empty values but classifies substantive number and boolean answers", () => {
    expect(outgoingDataCategories({ name: "   ", resume_text: "", empty: null })).toEqual([]);
    expect(outgoingDataCategories({ years_experience: 3, willing_to_travel: true })).toEqual(["written responses"]);
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

  it("uses Lever's current authenticated v1 apply contract without leaking its credential", async () => {
    // Regression: the implementation posted to the legacy public v0 postings
    // path with a site token. Current official Lever documentation specifies
    // POST /postings/:posting/apply under https://api.lever.co/v1.
    const receipt = issueSubmissionApproval(preview("lever"), secret);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await submitLever({ apiKey: "lever-secret", receipt, approvalSecret: secret }, fetcher);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.lever.co/v1/postings/222/apply");
    expect(url).not.toContain("approved-site");
    expect(url).not.toContain("lever-secret");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json", authorization: expect.stringMatching(/^Basic /u) });
    expect(JSON.parse(String(init.body))).toEqual(preview("lever").fields);
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
