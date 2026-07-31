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
  return { id: crypto.randomUUID(), packet: structuredClone(packet), packetHistory: [], state: "ready", timeline: [{ at: packet.createdAt, type: "packet.created", detail: `Packet v${packet.version} created` }], notes: [], contacts: [], interviewDates: [], followUpAt: null, compensation: "", referral: "", rejectionReason: "", nextAction: "Review and approve submission", documentLinks: [], emailLinks: [], calendarLinks: [] };
}

export function allowedTransitions(state: ApplicationState): readonly ApplicationState[] { return TRANSITIONS[state]; }

export async function transitionApplication(record: ApplicationRecord, next: ApplicationState, now = new Date()): Promise<ApplicationRecord> {
  if (!TRANSITIONS[record.state].includes(next)) throw new Error(`Invalid application transition: ${record.state} -> ${next}`);
  const updated = structuredClone(record);
  updated.state = next;
  updated.timeline.push({ at: now.toISOString(), type: "application.transition", detail: `${record.state} -> ${next}` });
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
