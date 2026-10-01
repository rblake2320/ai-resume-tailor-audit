import { afterEach, describe, expect, it } from "vitest";
import { createApplicationPacket } from "./applications";
import { createJobSnapshot } from "./job-inbox";
import type { TailorResult } from "./schema";
import { browserSubmissionPreview } from "./submission-preview";
import { POST } from "../app/api/submissions/preview/route";

const result: TailorResult = { match_score_before: 40, match_score_after: 60, score_rationale: "Fixture", changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [], requirement_evidence: [], ats_checks: [], tailored_resume_markdown: "# Reviewed engineer", cover_letter_markdown: "Dear hiring manager." };
async function input() { const jobSnapshot = await createJobSnapshot({ title: "Engineer", company: "Example", description: "Build reliable software systems with testing and careful review, documented releases, incident analysis, and accessible interfaces." }); return { record: { state: "ready", packet: await createApplicationPacket({ jobSnapshot, profile: { resume: "Candidate evidence", extraInfo: "" }, result }) }, target: { provider: "greenhouse" as const, boardToken: "example", jobId: "123" }, fields: { first_name: "Synthetic", last_name: "Candidate", email: "synthetic@example.com", resume_text: "Unreviewed replacement" } }; }
afterEach(() => { delete process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET; });
describe("browser exact submission review", () => {
  it("binds documents and disclosure categories to the current frozen packet", async () => {
    const data = await input(); const preview = await browserSubmissionPreview(data);
    expect(preview.fields.resume_text).toBe(data.record.packet.tailoredResult.tailored_resume_markdown);
    expect(preview.fields.cover_letter_text).toBe(data.record.packet.tailoredResult.cover_letter_markdown);
    expect(preview.personalDataCategories).toEqual(expect.arrayContaining(["email", "name", "resume", "cover letter"]));
    expect(preview.destination).toBe("https://boards.greenhouse.io/example/jobs/123");
    data.record.packet.tailoredResult.tailored_resume_markdown = "Tampered";
    await expect(browserSubmissionPreview(data)).rejects.toThrow(/integrity/);
  });
  it("requires human authentication before reading a packet and creates no provider action", async () => {
    process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = "human-test-review-secret";
    const denied = await POST(new Request("http://localhost/api/submissions/preview", { method: "POST", body: "{}" })); expect(denied.status).toBe(403);
    const data = await input(); const accepted = await POST(new Request("http://localhost/api/submissions/preview", { method: "POST", headers: { "content-type": "application/json", "x-resume-foundry-human-approval": "human-test-review-secret" }, body: JSON.stringify(data) }));
    expect(accepted.status).toBe(200); expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(await accepted.json()).toMatchObject({ packetChecksum: data.record.packet.checksums.packet });
  });
  it("refuses unready application and Gmail cross-workflow use", async () => {
    const data = await input(); data.record.state = "submitted"; await expect(browserSubmissionPreview(data)).rejects.toThrow(/ready/);
    data.record.state = "ready"; await expect(browserSubmissionPreview({ ...data, target: { provider: "gmail", rawMessage: "text" } })).rejects.toThrow(/Google draft/);
  });
  it("rejects private tracker history and contacts at the preview boundary", async () => {
    process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = "human-test-review-secret";
    const data = await input();
    const response = await POST(new Request("http://localhost/api/submissions/preview", { method: "POST", headers: { "content-type": "application/json", "x-resume-foundry-human-approval": "human-test-review-secret" }, body: JSON.stringify({ ...data, record: { ...data.record, contacts: [{ name: "Private recruiter", email: "private@example.test" }], packetHistory: [data.record.packet] } }) }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private@example.test");
  });
});
