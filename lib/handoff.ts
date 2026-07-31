import type { ApplicationRecord } from "./applications";
import { protectPii } from "./pii";

export interface HandoffReview {
  company: string; role: string; destination: string; packetVersion: number;
  resumeVersion: string; coverLetterVersion: string; answers: Record<string, string>;
  personalDataCategories: string[]; submissionMethod: "guided-manual";
  requiredConsents: string[];
}

export function buildHandoffReview(record: ApplicationRecord): HandoffReview {
  const packet = record.packet;
  const combined = `${packet.profileSnapshot.resume}\n${packet.profileSnapshot.extraInfo}`;
  return {
    company: packet.jobSnapshot.company,
    role: packet.jobSnapshot.title,
    destination: packet.jobSnapshot.applicationUrl,
    packetVersion: packet.version,
    resumeVersion: packet.checksums.resume.slice(0, 12),
    coverLetterVersion: packet.checksums.coverLetter.slice(0, 12),
    answers: structuredClone(packet.screeningAnswers),
    personalDataCategories: [...new Set(protectPii(combined).matches.map((match) => match.kind))],
    submissionMethod: "guided-manual",
    requiredConsents: ["reviewed-packet", "reviewed-personal-data", "understands-manual-handoff"],
  };
}

export function validHandoffDestination(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)); }
  catch { return false; }
}
