import { describe, expect, it } from "vitest";
import {
  appendCareerEvent, createCareerLedger, createDisclosurePacket, currentCareerEvents, deleteCareerEvent,
  exportEncryptedCareerLedger, importEncryptedCareerLedger, migrateCareerLedger, reviewInferredSkill, verifyCareerLedger,
  type CareerEventInput,
} from "./career-ledger";

const event = (overrides: Partial<CareerEventInput> = {}): CareerEventInput => ({
  occurredAt: "2026-01-10T12:00:00.000Z", category: "project", title: "Robotics team",
  description: "Built and tested the drivetrain with three classmates.", originalSource: "Workshop notebook page 14",
  claimState: "fact", verification: "artifact_attached",
  skills: [{ name: "hardware testing", state: "fact", source: "user" }],
  measurableResult: "Robot completed the course.", collaborators: ["Team member"], context: "School club",
  confidence: 0.95, tags: ["robotics"], occupationCodes: ["17-3024.00"],
  evidence: [{ id: "notebook-14", kind: "file", label: "Notebook", digest: "a".repeat(64), locator: "vault://notebook" }],
  visibility: "packet_selectable", supersedesEventId: null, correctionReason: "", ...overrides,
});

describe("career evidence ledger", () => {
  it("appends immutable hash-chained events and detects mutation", async () => {
    const original = createCareerLedger("owner-1", new Date("2026-01-01T00:00:00Z"));
    const first = await appendCareerEvent(original, event(), new Date("2026-01-11T00:00:00Z"));
    const second = await appendCareerEvent(first, event({ title: "Volunteer shift", category: "volunteering" }), new Date("2026-02-01T00:00:00Z"));
    expect(original.events).toHaveLength(0);
    expect(await verifyCareerLedger(second)).toEqual({ valid: true, errors: [] });
    const tampered = structuredClone(second); tampered.events[0].description = "Invented replacement";
    expect((await verifyCareerLedger(tampered)).valid).toBe(false);
  });

  it("corrects by superseding instead of rewriting history", async () => {
    let ledger = await appendCareerEvent(createCareerLedger("owner-1"), event());
    const original = ledger.events[0];
    ledger = await appendCareerEvent(ledger, event({ title: "Robotics team — corrected", supersedesEventId: original.id, correctionReason: "Corrected the project title." }));
    expect(ledger.events).toHaveLength(2);
    expect(ledger.events[0].title).toBe("Robotics team");
    expect(currentCareerEvents(ledger).map((entry) => entry.title)).toEqual(["Robotics team — corrected"]);
    await expect(appendCareerEvent(ledger, event({ supersedesEventId: original.id }))).rejects.toThrow(/explain/);
  });

  it("keeps AI suggestions unconfirmed and distinct from facts", async () => {
    const ledger = await appendCareerEvent(createCareerLedger("owner-1"), event({
      claimState: "unconfirmed_inference",
      skills: [{ name: "systems engineering", state: "unconfirmed_inference", source: "ai_suggestion" }],
    }));
    expect(ledger.events[0].claimState).toBe("unconfirmed_inference");
    expect(ledger.events[0].skills[0].state).not.toBe("fact");
  });

  it("selectively discloses only eligible events and removes private source details", async () => {
    let ledger = await appendCareerEvent(createCareerLedger("owner-1"), event());
    ledger = await appendCareerEvent(ledger, event({ title: "Private reflection", visibility: "private" }));
    ledger = await appendCareerEvent(ledger, event({ title: "Advisor note", visibility: "advisor_only" }));
    ledger = await appendCareerEvent(ledger, event({ title: "Guardian note", visibility: "guardian_visible" }));
    const packet = await createDisclosurePacket(ledger, ledger.events.map((entry) => entry.id));
    expect(packet.events).toHaveLength(1);
    expect(packet.events[0].title).toBe("Robotics team");
    expect(packet.events[0]).not.toHaveProperty("originalSource");
    expect(packet.events[0]).not.toHaveProperty("collaborators");
    expect(packet.events[0]).not.toHaveProperty("context");
    expect(packet.events[0]).not.toHaveProperty("correctionReason");
    expect(packet.events[0].evidence[0]).not.toHaveProperty("locator");
    expect(JSON.stringify(packet)).not.toContain("Advisor note");
    expect(JSON.stringify(packet)).not.toContain("Guardian note");
    expect(packet.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("exports and restores an encrypted, provider-independent backup losslessly", async () => {
    const ledger = await appendCareerEvent(createCareerLedger("owner-1"), event());
    const backup = await exportEncryptedCareerLedger(ledger, "a strong recovery phrase");
    expect(JSON.stringify(backup)).not.toContain("Robotics team");
    await expect(importEncryptedCareerLedger(backup, "wrong passphrase")).rejects.toThrow(/could not be decrypted/);
    expect(await importEncryptedCareerLedger(backup, "a strong recovery phrase")).toEqual(ledger);
  });

  it("rejects tampered encrypted backup bytes", async () => {
    const backup = await exportEncryptedCareerLedger(await appendCareerEvent(createCareerLedger("owner-1"), event()), "a strong recovery phrase");
    const tampered = { ...backup, ciphertext: `${backup.ciphertext.slice(0, -2)}AA` };
    await expect(importEncryptedCareerLedger(tampered, "a strong recovery phrase")).rejects.toThrow(/integrity verification/);
  });
  it("migrates a schema-v1 fixture losslessly into private v2 defaults", async () => {
    const current = await appendCareerEvent(createCareerLedger("owner-1"), event());
    const { privacy: _privacy, deletions: _deletions, ...legacyBody } = current;
    const legacy = { ...legacyBody, schemaVersion: 1 as const };
    const migrated = migrateCareerLedger(legacy);
    expect(migrated.schemaVersion).toBe(2); expect(migrated.events).toEqual(current.events);
    expect(migrated.privacy).toMatchObject({ ageBand: "unspecified", publicProfileEnabled: false, advertisingConsent: false });
  });
  it("enforces minor privacy defaults and explicit age-of-majority review", () => {
    const ledger = createCareerLedger("young-owner", new Date("2026-01-01T00:00:00Z"), "minor");
    expect(ledger.privacy).toMatchObject({ ageBand: "minor", publicProfileEnabled: false, guardianAssistance: "none" });
    expect(ledger.privacy.ageOfMajorityReviewDueAt).toBe("2027-01-01T00:00:00.000Z");
  });
  it("erases item content, retains a non-content receipt, and rebuilds integrity", async () => {
    let ledger = await appendCareerEvent(createCareerLedger("owner-1"), event()); const removed = ledger.events[0];
    ledger = await appendCareerEvent(ledger, event({ title: "Keep me" })); ledger = await deleteCareerEvent(ledger, removed.id, "Owner request", new Date("2026-03-01T00:00:00Z"));
    expect(JSON.stringify(ledger)).not.toContain("Robotics team"); expect(ledger.events.map((item) => item.title)).toEqual(["Keep me"]);
    expect(ledger.deletions[0]).toMatchObject({ eventId: removed.id, priorHash: removed.hash, reason: "Owner request" });
    expect((await verifyCareerLedger(ledger)).valid).toBe(true);
  });
  it("erases an entire correction lineage without resurrecting superseded content", async () => {
    let ledger = await appendCareerEvent(createCareerLedger("owner"), event({ title: "Sensitive original" }));
    const original = ledger.events[0];
    ledger = await appendCareerEvent(ledger, event({ title: "Sensitive correction", supersedesEventId: original.id, correctionReason: "Corrected" }));
    const correction = ledger.events[1];
    ledger = await deleteCareerEvent(ledger, correction.id, "Erase the corrected item");
    expect(currentCareerEvents(ledger)).toEqual([]);
    expect(JSON.stringify(ledger)).not.toContain("Sensitive original");
    expect(JSON.stringify(ledger)).not.toContain("Sensitive correction");
    expect((await verifyCareerLedger(ledger)).valid).toBe(true);
  });
  it("rejects AI-suggested skills that callers attempt to promote directly to facts", async () => {
    await expect(appendCareerEvent(createCareerLedger("owner"), event({
      skills: [{ name: "invented credential", state: "fact", source: "ai_suggestion" }],
    }))).rejects.toThrow(/cannot be recorded as facts/);
  });
  it("lets the owner confirm, edit, or reject AI skill mappings without upgrading them to facts", async () => {
    let ledger = await appendCareerEvent(createCareerLedger("owner"), event({ skills: [{ name: "systems thinking", state: "unconfirmed_inference", source: "ai_suggestion" }] }));
    ledger = await reviewInferredSkill(ledger, ledger.events[0].id, "systems thinking", { action: "edit", editedName: "systems analysis" });
    expect(currentCareerEvents(ledger)[0].skills).toEqual([{ name: "systems analysis", state: "user_confirmed_inference", source: "ai_suggestion" }]);
    expect(currentCareerEvents(ledger)[0].skills[0].state).not.toBe("fact");
    let rejection = await appendCareerEvent(createCareerLedger("owner"), event({ skills: [{ name: "leadership", state: "unconfirmed_inference", source: "ai_suggestion" }] }));
    rejection = await reviewInferredSkill(rejection, rejection.events[0].id, "leadership", { action: "reject" }); expect(currentCareerEvents(rejection)[0].skills).toEqual([]);
  });
});
