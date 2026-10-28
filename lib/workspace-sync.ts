import { createHash } from "node:crypto";
import { ApplicationRecordSchema } from "./application-record-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
import { z } from "zod";

const Records = ApplicationRecordSchema.array().max(100);
export type WorkspaceSnapshot = { records: z.infer<typeof Records>; revision: string; updatedAt: string };
const digest = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");

/** Transport checksums are integrity checks, never a claim of human truth. */
export function reviewedWorkspaceSnapshot(input: unknown, updatedAt: string): WorkspaceSnapshot {
  const records = Records.parse(input);
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error("Duplicate application IDs in workspace.");
  for (const record of records) for (const packet of [record.packet, ...record.packetHistory]) {
    const { checksums, ...body } = packet;
    const profileHash = digest({ resume: packet.profileSnapshot.resume, extraInfo: packet.profileSnapshot.extraInfo });
    if (checksums.packet !== digest(body) || checksums.job !== digest(packet.jobSnapshot) || checksums.profile !== profileHash || packet.profileSnapshot.checksum !== profileHash || checksums.resume !== digest(packet.tailoredResult.tailored_resume_markdown) || checksums.coverLetter !== digest(packet.tailoredResult.cover_letter_markdown)) throw new Error("Workspace packet integrity failed.");
  }
  return { records, revision: digest(records), updatedAt };
}
