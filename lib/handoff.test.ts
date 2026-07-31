import { describe, expect, it } from "vitest";
import { buildHandoffReview, validHandoffDestination } from "./handoff";
import type { ApplicationRecord } from "./applications";

const record = { packet: { version: 2, jobSnapshot: { company: "Acme", title: "Engineer", applicationUrl: "https://www.linkedin.com/jobs/view/123" }, profileSnapshot: { resume: "Jane Doe jane@example.com 555-555-1212", extraInfo: "" }, checksums: { resume: "a".repeat(64), coverLetter: "b".repeat(64) }, screeningAnswers: { sponsorship: "No" } } } as unknown as ApplicationRecord;

describe("guided handoff", () => {
  it("shows every required confirmation field and detected PII category", () => {
    expect(buildHandoffReview(record)).toMatchObject({ company: "Acme", role: "Engineer", destination: "https://www.linkedin.com/jobs/view/123", packetVersion: 2, answers: { sponsorship: "No" }, submissionMethod: "guided-manual", personalDataCategories: expect.arrayContaining(["email", "phone"]) });
  });
  it("allows official HTTPS destinations without automating them", () => {
    expect(validHandoffDestination("https://www.indeed.com/viewjob?jk=1")).toBe(true);
    expect(validHandoffDestination("javascript:alert(1)")).toBe(false);
    expect(validHandoffDestination("http://evil.example/job")).toBe(false);
  });
});
