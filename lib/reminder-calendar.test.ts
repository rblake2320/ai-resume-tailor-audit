import { describe, expect, it } from "vitest";
import { reminderCalendar } from "./reminder-calendar";
import { createApplicationRecord, approveReminder, type ApplicationPacket } from "./applications";

const record = () => ({ ...createApplicationRecord({ id: "packet", createdAt: "2026-09-30T12:00:00.000Z", jobSnapshot: { title: "Engineer\nATTENDEE:evil", company: "Example, Inc;" } } as ApplicationPacket), reminders: [{ id: "reminder", kind: "follow_up" as const, dueAt: "2026-10-07T12:00:00.000Z", status: "suggested" as const, createdAt: "2026-09-30T12:00:00.000Z", approvedAt: null, note: "Review only" }] });
describe("calendar reminder receiving artifact", () => {
  it("requires approval and produces an escaped UTC event with a display alarm", () => {
    const source = record(); expect(() => reminderCalendar(source, source.reminders[0])).toThrow(/Approve/);
    const approved = approveReminder(source, "reminder"); const text = reminderCalendar(approved, approved.reminders[0]);
    expect(text).toContain("DTSTART:20261007T120000Z\r\n"); expect(text).toContain("TRIGGER:-PT15M\r\nACTION:DISPLAY"); expect(text).not.toContain("\r\nATTENDEE:");
    expect(text).toContain("Engineer\\nATTENDEE:evil"); expect(text).toContain("Example\\, Inc\\;");
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
