import { createDisclosurePacket, currentCareerEvents, verifyCareerLedger, type CareerLedger } from "./career-ledger";

/** One explicit, reviewed disclosure; private vault fields never enter the prompt. */
export async function discloseCareerEvidence(ledger: CareerLedger, ids: readonly string[]) {
  const integrity = await verifyCareerLedger(ledger);
  if (!integrity.valid) throw new Error("Career ledger integrity failed. Restore a verified backup before disclosure.");
  const selected = currentCareerEvents(ledger).filter((event) => ids.includes(event.id));
  if (!selected.length || selected.length !== new Set(ids).size) throw new Error("Select current career entries before disclosure.");
  const packet = await createDisclosurePacket({ ...ledger, events: ledger.events.map((event) => ids.includes(event.id) ? { ...event, visibility: "packet_selectable" } : event) }, ids);
  const text = packet.events.map((event) => [
    `Source event ${event.id}; recorded ${event.occurredAt}; verification: ${event.verification}; claim: ${event.claimState}`,
    event.title, event.description,
    event.measurableResult ? `Candidate-reported result: ${event.measurableResult}` : "",
    event.skills.filter((skill) => skill.state !== "unconfirmed_inference").map((skill) => `${skill.name} (${skill.state})`).join(", "),
  ].filter(Boolean).join("\n")).join("\n\n");
  if (text.length > 20_000) throw new Error("Selected evidence exceeds 20,000 characters. Select fewer entries.");
  return { text: `Approved career evidence; disclosure checksum ${packet.checksum}\n${text}`, count: packet.events.length, checksum: packet.checksum };
}
