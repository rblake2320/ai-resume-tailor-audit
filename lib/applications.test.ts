import { describe, expect, it } from "vitest";
import { applicationAnalytics, approveReminder, buildInterviewPrep, createApplicationPacket, createApplicationRecord, dismissReminder, transitionApplication, verifyApplicationPacket } from "./applications";
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
  it("re-verifies every immutable artifact and rejects a rehydrated tampered packet", async () => {
    const created = await packet();
    expect(await verifyApplicationPacket(created)).toEqual({ valid: true, errors: [] });
    const tampered = structuredClone(created); tampered.tailoredResult.tailored_resume_markdown = "# Unapproved replacement";
    expect(await verifyApplicationPacket(tampered)).toMatchObject({ valid: false });
    await expect(transitionApplication(createApplicationRecord(tampered), "submitted")).rejects.toThrow(/integrity failed/);
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
  it("suggests state-bound reminders but never schedules without user approval", async () => {
    const submitted = await transitionApplication(createApplicationRecord(await packet()), "submitted", new Date("2026-01-02T00:00:00Z"));
    expect(submitted.reminders[0]).toMatchObject({ kind: "follow_up", status: "suggested", approvedAt: null, dueAt: "2026-01-09T00:00:00.000Z" });
    expect(submitted.followUpAt).toBeNull();
    const scheduled = approveReminder(submitted, submitted.reminders[0].id, new Date("2026-01-02T01:00:00Z"));
    expect(scheduled.reminders[0].status).toBe("scheduled"); expect(scheduled.followUpAt).toBe("2026-01-09T00:00:00.000Z");
    expect(dismissReminder(scheduled, scheduled.reminders[0].id).followUpAt).toBeNull();
  });
  it("builds interview preparation from the immutable submitted packet only", async () => {
    let record = await transitionApplication(createApplicationRecord(await packet()), "submitted");
    record = await transitionApplication(record, "recruiter_response"); record = await transitionApplication(record, "interviewing");
    const prep = buildInterviewPrep(record); const originalRole = prep.role;
    result.gap_analysis.push({ gap: "Live profile mutation", advice: "Must not leak" });
    expect(buildInterviewPrep(record)).toEqual(prep); expect(prep.role).toBe(originalRole); expect(prep.packetChecksum).toBe(record.packet.checksums.packet);
  });
});
