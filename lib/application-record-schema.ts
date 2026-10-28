import { z } from "zod";
import { TailorResultSchema, JobPostingSnapshotSchema } from "./schema.ts";
import type { ApplicationRecord } from "./applications";

export const ApplicationPacketSchema = z.strictObject({
  id: z.string().min(1), version: z.number().int().positive(), jobSnapshot: JobPostingSnapshotSchema,
  profileSnapshot: z.strictObject({ resume: z.string(), extraInfo: z.string(), checksum: z.string().min(1) }),
  tailoredResult: TailorResultSchema, screeningAnswers: z.record(z.string(), z.string()), userEdits: z.array(z.string()),
  submissionChannel: z.enum(["guided", "email", "lever", "greenhouse", "other"]).nullable(),
  checksums: z.strictObject({ job: z.string().min(1), profile: z.string().min(1), resume: z.string().min(1), coverLetter: z.string().min(1), packet: z.string().min(1) }),
  createdAt: z.iso.datetime(), submittedAt: z.iso.datetime().nullable(),
});
export const ApplicationRecordSchema: z.ZodType<ApplicationRecord> = z.strictObject({
  id: z.string().min(1), packet: ApplicationPacketSchema, packetHistory: z.array(ApplicationPacketSchema).default([]),
  state: z.enum(["discovered", "saved", "reviewing", "tailoring", "ready", "submitted", "recruiter_response", "interviewing", "offer", "rejected", "withdrawn", "no_response"]),
  timeline: z.array(z.strictObject({ at: z.string(), type: z.string(), detail: z.string() })), notes: z.array(z.string()),
  contacts: z.array(z.strictObject({ name: z.string(), role: z.string(), email: z.string() })), interviewDates: z.array(z.string()),
  followUpAt: z.string().nullable(), compensation: z.string(), referral: z.string(), rejectionReason: z.string(), nextAction: z.string(),
  documentLinks: z.array(z.string()), emailLinks: z.array(z.string()), calendarLinks: z.array(z.string()),
  reminders: z.array(z.strictObject({ id: z.string().min(1), kind: z.enum(["follow_up", "interview_prep"]), dueAt: z.string(), status: z.enum(["suggested", "scheduled", "completed", "dismissed"]), createdAt: z.string(), approvedAt: z.string().nullable(), note: z.string() })).default([]),
});
