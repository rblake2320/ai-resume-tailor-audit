import type { TailorResult } from "./schema";
import type { JobPostingSnapshot } from "./schema";
import { sha256 } from "./job-inbox";

export const APPLICATION_STATES = [
  "discovered", "saved", "reviewing", "tailoring", "ready", "submitted",
  "recruiter_response", "interviewing", "offer", "rejected", "withdrawn", "no_response",
] as const;
export type ApplicationState = typeof APPLICATION_STATES[number];

const TRANSITIONS: Record<ApplicationState, readonly ApplicationState[]> = {
  discovered: ["saved", "withdrawn"], saved: ["reviewing", "withdrawn"],
  reviewing: ["tailoring", "withdrawn"], tailoring: ["ready", "reviewing", "withdrawn"],
  ready: ["submitted", "tailoring", "withdrawn"], submitted: ["recruiter_response", "no_response", "withdrawn", "rejected"],
  recruiter_response: ["interviewing", "rejected", "withdrawn"], interviewing: ["offer", "rejected", "withdrawn"],
  offer: ["withdrawn"], rejected: [], withdrawn: [], no_response: ["recruiter_response"],
};

export interface ApplicationPacket {
  id: string;
  version: number;
  jobSnapshot: JobPostingSnapshot;
  profileSnapshot: { resume: string; extraInfo: string; checksum: string };
  tailoredResult: TailorResult;
  screeningAnswers: Record<string, string>;
  userEdits: string[];
  submissionChannel: "guided" | "email" | "lever" | "greenhouse" | "other" | null;
  checksums: { job: string; profile: string; resume: string; coverLetter: string; packet: string };
  createdAt: string;
  submittedAt: string | null;
}

export interface ApplicationEvent { at: string; type: string; detail: string }
export interface ApplicationReminder {
  id: string;
  kind: "follow_up" | "interview_prep";
  dueAt: string;
  status: "suggested" | "scheduled" | "completed" | "dismissed";
  createdAt: string;
  approvedAt: string | null;
  note: string;
}
export interface ApplicationRecord {
  id: string;
  packet: ApplicationPacket;
  packetHistory: ApplicationPacket[];
  state: ApplicationState;
  timeline: ApplicationEvent[];
  notes: string[];
  contacts: { name: string; role: string; email: string }[];
  interviewDates: string[];
  followUpAt: string | null;
  compensation: string;
  referral: string;
  rejectionReason: string;
  nextAction: string;
  documentLinks: string[];
  emailLinks: string[];
  calendarLinks: string[];
  reminders: ApplicationReminder[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function createApplicationPacket(input: {
  jobSnapshot: JobPostingSnapshot;
  profile: { resume: string; extraInfo: string };
  result: TailorResult;
  screeningAnswers?: Record<string, string>;
  userEdits?: string[];
  now?: Date;
}): Promise<ApplicationPacket> {
  const createdAt = (input.now ?? new Date()).toISOString();
  const profileChecksum = await sha256(canonical(input.profile));
  const partial = {
    id: crypto.randomUUID(), version: 1, jobSnapshot: structuredClone(input.jobSnapshot),
    profileSnapshot: { ...structuredClone(input.profile), checksum: profileChecksum },
    tailoredResult: structuredClone(input.result), screeningAnswers: structuredClone(input.screeningAnswers ?? {}),
    userEdits: structuredClone(input.userEdits ?? []), submissionChannel: null, createdAt, submittedAt: null,
  };
  const checksums = {
    job: await sha256(canonical(partial.jobSnapshot)), profile: profileChecksum,
    resume: await sha256(partial.tailoredResult.tailored_resume_markdown),
    coverLetter: await sha256(partial.tailoredResult.cover_letter_markdown),
    packet: await sha256(canonical(partial)),
  };
  return structuredClone({ ...partial, checksums });
}

export function createApplicationRecord(packet: ApplicationPacket): ApplicationRecord {
  return { id: crypto.randomUUID(), packet: structuredClone(packet), packetHistory: [], state: "ready", timeline: [{ at: packet.createdAt, type: "packet.created", detail: `Packet v${packet.version} created` }], notes: [], contacts: [], interviewDates: [], followUpAt: null, compensation: "", referral: "", rejectionReason: "", nextAction: "Review and approve submission", documentLinks: [], emailLinks: [], calendarLinks: [], reminders: [] };
}

function suggestedReminder(next: ApplicationState, now: Date): ApplicationReminder | null {
  const days = next === "submitted" ? 7 : next === "recruiter_response" ? 2 : next === "interviewing" ? 1 : null;
  if (days === null) return null;
  const due = new Date(now); due.setUTCDate(due.getUTCDate() + days);
  const kind = next === "interviewing" ? "interview_prep" : "follow_up";
  return { id: crypto.randomUUID(), kind, dueAt: due.toISOString(), status: "suggested", createdAt: now.toISOString(), approvedAt: null,
    note: kind === "interview_prep" ? "Prepare from the exact submitted packet." : "Review and approve this follow-up reminder." };
}

export function approveReminder(record: ApplicationRecord, reminderId: string, now = new Date()): ApplicationRecord {
  const updated = structuredClone(record); const reminder = updated.reminders.find((item) => item.id === reminderId);
  if (!reminder || reminder.status !== "suggested") throw new Error("Only a suggested reminder can be approved.");
  reminder.status = "scheduled"; reminder.approvedAt = now.toISOString();
  updated.followUpAt = reminder.kind === "follow_up" ? reminder.dueAt : updated.followUpAt;
  updated.timeline.push({ at: now.toISOString(), type: "reminder.approved", detail: `${reminder.kind} at ${reminder.dueAt}` });
  return updated;
}

export function dismissReminder(record: ApplicationRecord, reminderId: string, now = new Date()): ApplicationRecord {
  const updated = structuredClone(record); const reminder = updated.reminders.find((item) => item.id === reminderId);
  if (!reminder || !["suggested", "scheduled"].includes(reminder.status)) throw new Error("Reminder is already terminal.");
  reminder.status = "dismissed"; if (updated.followUpAt === reminder.dueAt) updated.followUpAt = null;
  updated.timeline.push({ at: now.toISOString(), type: "reminder.dismissed", detail: reminder.kind }); return updated;
}

export function buildInterviewPrep(record: ApplicationRecord) {
  const packet = structuredClone(record.packet);
  return {
    packetId: packet.id, packetVersion: packet.version, packetChecksum: packet.checksums.packet,
    role: packet.jobSnapshot.title, company: packet.jobSnapshot.company,
    boundAt: packet.submittedAt ?? packet.createdAt,
    evidenceStories: packet.tailoredResult.requirement_evidence.filter((item) => item.state === "proven" || item.state === "partially_supported").map((item) => ({ requirement: item.requirement, evidence: item.evidence })),
    honestGaps: packet.tailoredResult.gap_analysis.map((item) => ({ ...item })),
    questionsToPrepare: packet.tailoredResult.requirement_evidence.map((item) => `How would you demonstrate: ${item.requirement}?`),
    questionsToAsk: [`What would success in the first 90 days look like for ${packet.jobSnapshot.title}?`, "Which requirements matter most during the first six months?"],
  };
}

export function allowedTransitions(state: ApplicationState): readonly ApplicationState[] { return TRANSITIONS[state]; }

export async function transitionApplication(record: ApplicationRecord, next: ApplicationState, now = new Date()): Promise<ApplicationRecord> {
  if (!TRANSITIONS[record.state].includes(next)) throw new Error(`Invalid application transition: ${record.state} -> ${next}`);
  const updated = structuredClone(record);
  updated.state = next;
  updated.timeline.push({ at: now.toISOString(), type: "application.transition", detail: `${record.state} -> ${next}` });
  const reminder = suggestedReminder(next, now); if (reminder) updated.reminders.push(reminder);
  if (next === "submitted") {
    updated.packetHistory.push(structuredClone(updated.packet));
    const { checksums: _oldChecksums, ...packetBody } = updated.packet;
    const versionedBody = { ...packetBody, id: crypto.randomUUID(), version: updated.packet.version + 1, submittedAt: now.toISOString() };
    updated.packet = {
      ...versionedBody,
      checksums: { ...updated.packet.checksums, packet: await sha256(canonical(versionedBody)) },
    };
    updated.timeline.push({ at: now.toISOString(), type: "packet.versioned", detail: `Packet v${updated.packet.version} sealed for submission` });
  }
  return updated;
}

export function applicationAnalytics(records: readonly ApplicationRecord[]) {
  const submitted = records.filter((record) => record.packet.submittedAt);
  const responses = records.filter((record) => ["recruiter_response", "interviewing", "offer"].includes(record.state));
  const interviews = records.filter((record) => ["interviewing", "offer"].includes(record.state));
  const source = new Map<string, { applications: number; responses: number }>();
  const resume = new Map<string, { applications: number; responses: number }>();
  const missing = new Map<string, number>();
  for (const record of records) {
    const sourceKey = record.packet.jobSnapshot.source;
    const sourceRow = source.get(sourceKey) ?? { applications: 0, responses: 0 };
    sourceRow.applications += 1; if (responses.includes(record)) sourceRow.responses += 1; source.set(sourceKey, sourceRow);
    const resumeKey = record.packet.profileSnapshot.checksum.slice(0, 12);
    const resumeRow = resume.get(resumeKey) ?? { applications: 0, responses: 0 };
    resumeRow.applications += 1; if (responses.includes(record)) resumeRow.responses += 1; resume.set(resumeKey, resumeRow);
    for (const item of record.packet.tailoredResult.requirement_evidence ?? []) if (item.state === "unsupported") missing.set(item.requirement, (missing.get(item.requirement) ?? 0) + 1);
  }
  const now = Date.now();
  const perWeek = new Map<string, number>();
  for (const record of submitted) { const date = new Date(record.packet.submittedAt!); const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - date.getUTCDay())); const key = start.toISOString().slice(0, 10); perWeek.set(key, (perWeek.get(key) ?? 0) + 1); }
  const responseHours = responses.flatMap((record) => { const response = record.timeline.find((event) => event.detail.includes("-> recruiter_response")); return response && record.packet.submittedAt ? [(new Date(response.at).getTime() - new Date(record.packet.submittedAt).getTime()) / 3_600_000] : []; });
  return {
    applicationsPerWeek: Object.fromEntries(perWeek), responseRate: submitted.length ? responses.length / submitted.length : 0,
    interviewConversionRate: submitted.length ? interviews.length / submitted.length : 0,
    sourceEffectiveness: Object.fromEntries(source), resumeVersionEffectiveness: Object.fromEntries(resume),
    averageResponseHours: responseHours.length ? responseHours.reduce((a, b) => a + b, 0) / responseHours.length : null,
    skillsMostOftenMissing: [...missing].sort((a, b) => b[1] - a[1]),
    companiesAwaitingFollowUp: records.filter((record) => record.followUpAt && new Date(record.followUpAt).getTime() <= now).map((record) => record.packet.jobSnapshot.company),
    rolesNeedingAttention: records.filter((record) => record.nextAction || ["saved", "reviewing", "ready", "no_response"].includes(record.state)).map((record) => ({ title: record.packet.jobSnapshot.title, company: record.packet.jobSnapshot.company, nextAction: record.nextAction })),
  };
}
