import { describe, expect, it } from "vitest";
import { applicationAnalytics, createApplicationPacket, createApplicationRecord, transitionApplication } from "./applications";
import { createJobSnapshot } from "./job-inbox";
import type { TailorResult } from "./schema";

const result: TailorResult = { match_score_before: 50, match_score_after: 70, score_rationale: "Evidence improved alignment.", changes: [], keywords: { matched: [], added: [], not_added: [{ keyword: "Rust", reason: "No evidence" }] }, gap_analysis: [], requirement_evidence: [{ id: "rust", requirement: "Rust", category: "mandatory", state: "unsupported", evidence: [], tailoredText: [], recommendation: "Build a project" }], ats_checks: [], tailored_resume_markdown: "# Resume", cover_letter_markdown: "Cover" };

async function packet() {
  const job = await createJobSnapshot({ company: "Acme", title: "Engineer", description: "Build reliable software systems with TypeScript, PostgreSQL, observability, testing, security, incident response, documentation, collaboration, mentoring, and production ownership." });
  return createApplicationPacket({ jobSnapshot: job, profile: { resume: "Original", extraInfo: "Evidence" }, result, now: new Date("2026-01-01T00:00:00Z") });
}

describe("immutable application packets", () => {
  it("checksums every artifact and is detached from later source edits", async () => {
    const created = await packet(); const old = created.tailoredResult.tailored_resume_markdown;
    result.tailored_resume_markdown = "Changed later";
    expect(created.checksums.packet).toMatch(/^[a-f0-9]{64}$/); expect(created.checksums.resume).toMatch(/^[a-f0-9]{64}$/); expect(created.tailoredResult.tailored_resume_markdown).toBe(old);
  });
  it("allows only valid state transitions and records submission time", async () => {
    const record = createApplicationRecord(await packet());
    await expect(transitionApplication(record, "offer")).rejects.toThrow(/Invalid application transition/);
    const submitted = await transitionApplication(record, "submitted", new Date("2026-01-02T00:00:00Z"));
    expect(submitted.packet.submittedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(submitted.packet.version).toBe(2);
    expect(submitted.packet.checksums.packet).not.toBe(record.packet.checksums.packet);
    expect(submitted.packetHistory).toEqual([record.packet]);
    expect(record.state).toBe("ready"); expect(record.packet.submittedAt).toBeNull();
  });
  it("reports every required analytics family", async () => {
    const submitted = await transitionApplication(createApplicationRecord(await packet()), "submitted");
    const analytics = applicationAnalytics([submitted]);
    expect(analytics).toMatchObject({ responseRate: 0, interviewConversionRate: 0 });
    expect(Object.keys(analytics)).toEqual(expect.arrayContaining(["applicationsPerWeek", "sourceEffectiveness", "resumeVersionEffectiveness", "averageResponseHours", "skillsMostOftenMissing", "companiesAwaitingFollowUp", "rolesNeedingAttention"]));
  });
});
