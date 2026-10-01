import { ApplicationPacketSchema } from "./application-record-schema";
import { verifyApplicationPacket } from "./applications";
import { outgoingDataCategories, SubmissionPreviewSchema, submissionDestination, SubmissionTargetSchema } from "./submission-connectors";
import { z } from "zod";

// Historical packets, private tracker notes and contacts have no role in a
// current submission preview and must not cross this boundary.
export const BrowserSubmissionSchema = z.strictObject({ record: z.strictObject({ packet: ApplicationPacketSchema, state: z.string().max(50) }), target: SubmissionTargetSchema, fields: z.record(z.string(), z.unknown()) });
export async function browserSubmissionPreview(input: z.infer<typeof BrowserSubmissionSchema>) {
  const { record, target, fields } = BrowserSubmissionSchema.parse(input);
  if (target.provider === "gmail") throw new Error("Use the reviewed Google draft workflow for email.");
  if (record.state !== "ready") throw new Error("Only a reviewed ready application can enter direct submission.");
  if (!(await verifyApplicationPacket(record.packet)).valid) throw new Error("Application packet integrity failed.");
  const packet = record.packet;
  const boundFields = { ...fields, resume_text: packet.tailoredResult.tailored_resume_markdown, cover_letter_text: packet.tailoredResult.cover_letter_markdown };
  return SubmissionPreviewSchema.parse({ applicationId: packet.id, provider: target.provider, company: packet.jobSnapshot.company, role: packet.jobSnapshot.title, destination: submissionDestination(target), packetVersion: packet.version, resumeChecksum: packet.checksums.resume, coverLetterChecksum: packet.checksums.coverLetter, packetChecksum: packet.checksums.packet, personalDataCategories: outgoingDataCategories(boundFields, target), fields: boundFields, createdAt: new Date().toISOString(), target });
}
