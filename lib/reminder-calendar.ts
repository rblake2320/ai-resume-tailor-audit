import type { ApplicationRecord, ApplicationReminder } from "./applications";

const escape = (text: string) => text.replaceAll("\\", "\\\\").replaceAll("\r", "").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
function stamp(date: Date) { if (!Number.isFinite(date.getTime())) throw new Error("Invalid reminder date."); return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, ""); }
function fold(line: string) {
  let out = "", size = 0;
  for (const character of line) { const bytes = new TextEncoder().encode(character).length; if (size + bytes > 75) { out += "\r\n "; size = 1; } out += character; size += bytes; }
  return out;
}
/** RFC 5545 UTC event with an explicit display alarm; no invitations or sends. */
export function reminderCalendar(record: ApplicationRecord, reminder: ApplicationReminder, now = new Date()) {
  if (reminder.status !== "scheduled" || !reminder.approvedAt || !record.reminders.some((item) => item.id === reminder.id && item.status === "scheduled")) throw new Error("Approve this reminder before exporting it.");
  const title = `${reminder.kind.replaceAll("_", " ")}: ${record.packet.jobSnapshot.title} @ ${record.packet.jobSnapshot.company}`;
  const start = new Date(reminder.dueAt), end = new Date(start.getTime() + 30 * 60_000);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Resume Foundry//Reviewed Reminders//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${escape(reminder.id)}@resume-foundry.local`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${escape(title)}`, `DESCRIPTION:${escape(reminder.note)}`, "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", `DESCRIPTION:${escape(title)}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
