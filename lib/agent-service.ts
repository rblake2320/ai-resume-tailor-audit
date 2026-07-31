import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const AGENT_OPERATIONS = [
  "jobs.import", "jobs.search", "jobs.get", "jobs.compare", "jobs.dismiss", "matches.score",
  "applications.prepare", "applications.review", "applications.approve", "applications.open_handoff",
  "applications.mark_submitted", "applications.record_response", "applications.schedule_followup", "analytics.summary",
] as const;
export type AgentOperation = typeof AGENT_OPERATIONS[number];

const AgentRequestSchema = z.strictObject({
  operation: z.enum(AGENT_OPERATIONS), input: z.record(z.string(), z.unknown()).default({}),
  actor: z.string().min(1).max(200).default("agent"),
  piiApproved: z.boolean().default(false), humanApprovalSecret: z.string().optional(),
});
export type AgentRequest = z.input<typeof AgentRequestSchema>;

type StoredJob = { id: string; title: string; company: string; description: string; url: string; dismissed: boolean; importedAt: string };
type StoredApplication = { id: string; jobId: string; state: "prepared" | "approved" | "handoff_opened" | "submitted"; packet: Record<string, unknown>; approvedAt: string | null; submittedAt: string | null; responses: unknown[]; followUps: string[] };
export type AuditEntry = { id: string; at: string; actor: string; operation: AgentOperation; allowed: boolean; reason: string; inputHash: string; resultId: string | null };
type Store = { version: 1; jobs: StoredJob[]; applications: StoredApplication[]; audit: AuditEntry[] };
const emptyStore = (): Store => ({ version: 1, jobs: [], applications: [], audit: [] });

const storePath = () => {
  const configured = process.env.RESUME_FOUNDRY_AGENT_STORE?.trim();
  if (!configured) throw new Error("RESUME_FOUNDRY_AGENT_STORE must be configured for durable agent operations.");
  return configured;
};
async function loadStore(): Promise<Store> { try { return JSON.parse(await readFile(storePath(), "utf8")) as Store; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore(); throw error; } }
async function saveStore(store: Store) { const target = storePath(); await mkdir(path.dirname(target), { recursive: true }); const temp = `${target}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temp, target); }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value: unknown, name: string, minimum = 1) => { if (typeof value !== "string" || value.trim().length < minimum) throw new Error(`${name} is required.`); return value.trim(); };

function decision(operation: AgentOperation, request: z.output<typeof AgentRequestSchema>) {
  if (operation === "applications.approve") {
    const secret = process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET;
    if (!secret || request.humanApprovalSecret !== secret) return { allowed: false, reason: "Explicit human approval secret is required." };
  }
  if (["applications.open_handoff", "applications.mark_submitted"].includes(operation) && request.piiApproved !== true) return { allowed: false, reason: "Protected PII disclosure requires explicit approval." };
  return { allowed: true, reason: "Policy satisfied." };
}

function today(value: string) { return value.slice(0, 10); }
async function executeAgentOperationInner(raw: AgentRequest) {
  const request = AgentRequestSchema.parse(raw); const store = await loadStore(); const now = new Date().toISOString();
  const permission = decision(request.operation, request); let result: unknown = null; let resultId: string | null = null;
  try {
    if (!permission.allowed) throw new Error(permission.reason);
    const input = request.input;
    switch (request.operation) {
      case "jobs.import": { const job: StoredJob = { id: randomUUID(), title: text(input.title, "title"), company: text(input.company, "company"), description: text(input.description, "description", 20), url: typeof input.url === "string" ? input.url : "", dismissed: false, importedAt: now }; store.jobs.push(job); result = job; resultId = job.id; break; }
      case "jobs.search": { const query = String(input.query ?? "").toLowerCase(); result = store.jobs.filter((job) => !job.dismissed && `${job.title} ${job.company} ${job.description}`.toLowerCase().includes(query)); break; }
      case "jobs.get": { result = store.jobs.find((job) => job.id === input.id) ?? null; break; }
      case "jobs.compare": { const ids = Array.isArray(input.ids) ? input.ids : []; result = store.jobs.filter((job) => ids.includes(job.id)); break; }
      case "jobs.dismiss": { const job = store.jobs.find((item) => item.id === input.id); if (!job) throw new Error("Job not found."); job.dismissed = true; result = job; resultId = job.id; break; }
      case "matches.score": { const job = store.jobs.find((item) => item.id === input.jobId); if (!job) throw new Error("Job not found."); const evidence = Array.isArray(input.evidence) ? input.evidence.map(String) : []; const words = new Set(evidence.join(" ").toLowerCase().split(/\W+/u)); const terms = job.description.toLowerCase().split(/\W+/u).filter((term) => term.length > 3); const matched = [...new Set(terms.filter((term) => words.has(term)))]; result = { jobId: job.id, score: terms.length ? Math.round(matched.length / new Set(terms).size * 100) : 0, matched, policy: "lexical evidence only; no qualification inference" }; break; }
      case "applications.prepare": { const job = store.jobs.find((item) => item.id === input.jobId); if (!job) throw new Error("Job not found."); const application: StoredApplication = { id: randomUUID(), jobId: job.id, state: "prepared", packet: structuredClone((input.packet ?? {}) as Record<string, unknown>), approvedAt: null, submittedAt: null, responses: [], followUps: [] }; store.applications.push(application); result = application; resultId = application.id; break; }
      case "applications.review": { result = store.applications.find((item) => item.id === input.applicationId) ?? null; break; }
      case "applications.approve": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application || application.state !== "prepared") throw new Error("Only a prepared application can be approved."); application.state = "approved"; application.approvedAt = now; result = application; resultId = application.id; break; }
      case "applications.open_handoff": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application || application.state !== "approved") throw new Error("Approved application required."); application.state = "handoff_opened"; result = application; resultId = application.id; break; }
      case "applications.mark_submitted": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application || !["approved", "handoff_opened"].includes(application.state)) throw new Error("Approved application required."); const limit = Number(process.env.RESUME_FOUNDRY_DAILY_APPLICATION_LIMIT ?? 10); const count = store.applications.filter((item) => item.submittedAt && today(item.submittedAt) === today(now)).length; if (!Number.isInteger(limit) || limit < 1 || count >= limit) throw new Error("Daily application limit reached."); application.state = "submitted"; application.submittedAt = now; result = application; resultId = application.id; break; }
      case "applications.record_response": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application) throw new Error("Application not found."); application.responses.push({ at: now, value: input.response ?? null }); result = application; resultId = application.id; break; }
      case "applications.schedule_followup": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application) throw new Error("Application not found."); const dueAt = text(input.dueAt, "dueAt"); if (!Number.isFinite(new Date(dueAt).getTime())) throw new Error("dueAt must be an ISO date."); application.followUps.push(new Date(dueAt).toISOString()); result = application; resultId = application.id; break; }
      case "analytics.summary": result = { jobs: store.jobs.length, activeJobs: store.jobs.filter((job) => !job.dismissed).length, applications: store.applications.length, submitted: store.applications.filter((item) => item.submittedAt).length }; break;
    }
    store.audit.push({ id: randomUUID(), at: now, actor: request.actor, operation: request.operation, allowed: true, reason: permission.reason, inputHash: hash(request.input), resultId });
    await saveStore(store); return { ok: true, operation: request.operation, result };
  } catch (error) {
    store.audit.push({ id: randomUUID(), at: now, actor: request.actor, operation: request.operation, allowed: false, reason: error instanceof Error ? error.message : "Operation denied.", inputHash: hash(request.input), resultId: null });
    await saveStore(store); return { ok: false, operation: request.operation, error: error instanceof Error ? error.message : "Operation denied." };
  }
}

let operationQueue: Promise<void> = Promise.resolve();
export async function executeAgentOperation(raw: AgentRequest) {
  const preceding = operationQueue; let release!: () => void;
  operationQueue = new Promise<void>((resolve) => { release = resolve; });
  await preceding;
  try { return await executeAgentOperationInner(raw); } finally { release(); }
}

export async function queryAuditLog(): Promise<AuditEntry[]> { return (await loadStore()).audit.map((entry) => ({ ...entry })); }
