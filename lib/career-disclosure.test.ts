import { describe, expect, it } from "vitest";
import { appendCareerEvent, createCareerLedger, type CareerEventInput } from "./career-ledger";
import { discloseCareerEvidence } from "./career-disclosure";

const entry = (title: string): CareerEventInput => ({ occurredAt: "2026-09-30T12:00:00.000Z", category: "project", title, description: `Completed ${title}`, originalSource: "private://source", claimState: "fact", verification: "self_reported", skills: [{ name: "invented inference", state: "unconfirmed_inference", source: "ai_suggestion" }, { name: "SQL", state: "fact", source: "user" }], measurableResult: "", collaborators: ["Private person"], context: "Private context", confidence: 1, tags: [], occupationCodes: [], evidence: [], visibility: "private", supersedesEventId: null, correctionReason: "" });
describe("explicit vault disclosure", () => {
  it("includes only selected current evidence and no private sources or unconfirmed skills", async () => {
    let ledger = await appendCareerEvent(createCareerLedger("owner"), entry("Selected project"));
    ledger = await appendCareerEvent(ledger, entry("Private project"));
    const original = structuredClone(ledger);
    const packet = await discloseCareerEvidence(ledger, [ledger.events[0].id]);
    expect(packet.count).toBe(1); expect(packet.text).toContain("Selected project"); expect(packet.text).toContain("SQL");
    for (const privateText of ["private://source", "Private person", "Private context", "Private project", "invented inference"]) expect(packet.text).not.toContain(privateText);
    expect(ledger).toEqual(original);
  });
  it("refuses tampered, empty and stale selections", async () => {
    const ledger = await appendCareerEvent(createCareerLedger("owner"), entry("Project"));
    await expect(discloseCareerEvidence(ledger, [])).rejects.toThrow(/Select/);
    await expect(discloseCareerEvidence(ledger, ["missing"])).rejects.toThrow(/Select/);
    ledger.events[0].description = "Fabricated";
    await expect(discloseCareerEvidence(ledger, [ledger.events[0].id])).rejects.toThrow(/integrity/);
  });
});
