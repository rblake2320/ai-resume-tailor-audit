import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withFileLock } from "./file-lock.ts";
import { appendAuthenticatedAudit, assertAgentAuditConfigured, verifyAuthenticatedAudit, type AgentAuditEntry } from "./agent-audit.ts";

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
type StoredApplication = { id: string; jobId: string; state: "prepared" | "approved" | "handoff_opened" | "submitted"; packet: Record<string, unknown>; approvedAt: string | null; submittedAt: string | null; /** First outward disclosure; consumes one unit of daily quota. */ disclosedAt?: string | null; responses: unknown[]; followUps: string[] };
export type AuditEntry = AgentAuditEntry;
type Store = { version: 1; jobs: StoredJob[]; applications: StoredApplication[]; audit: AuditEntry[] };
const emptyStore = (): Store => ({ version: 1, jobs: [], applications: [], audit: [] });
export const UNAUTHENTICATED_DENIALS_PER_UTC_DAY = 32;

const storePath = () => {
  const configured = process.env.RESUME_FOUNDRY_AGENT_STORE?.trim();
  if (!configured) throw new Error("RESUME_FOUNDRY_AGENT_STORE must be configured for durable agent operations.");
  // A relative path silently resolved against the process CWD — exactly the
  // ephemeral deployment directory the documented guarantee promises to refuse.
  if (!path.isAbsolute(configured)) throw new Error("RESUME_FOUNDRY_AGENT_STORE must be an absolute path on durable storage.");
  return configured;
};
async function loadStore(): Promise<Store> { try { const store = JSON.parse(await readFile(storePath(), "utf8")) as Store; verifyAuthenticatedAudit(store.audit); return store; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore(); throw error; } }
async function saveStore(store: Store) { const target = storePath(); await mkdir(path.dirname(target), { recursive: true }); const temp = `${target}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temp, target); }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function addAudit(store: Store, entry: Omit<AuditEntry, "id" | "at" | "previousMac" | "mac">, now = new Date().toISOString()) {
  store.audit.push(appendAuthenticatedAudit(store.audit, { id: randomUUID(), at: now, ...entry }));
}
const text = (value: unknown, name: string, minimum = 1) => { if (typeof value !== "string" || value.trim().length < minimum) throw new Error(`${name} is required.`); return value.trim(); };

/**
 * Operations that accept or return raw packet content — résumé text, cover
 * letter, contact details. `applications.review` returns the entire stored
 * packet and `applications.prepare` writes it, so both handle PII. Both were
 * previously ungated, so any bearer holder could read back every stored résumé
 * and its personal identifiers with no approval of any kind.
 */
const PII_OPERATIONS: readonly AgentOperation[] = [
  "applications.prepare", "applications.review", "applications.open_handoff", "applications.mark_submitted",
];

function secretsMatch(supplied: unknown, expected: string) {
  if (typeof supplied !== "string") return false;
  const a = Buffer.from(supplied, "utf8"); const b = Buffer.from(expected, "utf8");
  // Compare a fixed-size digest so differing lengths do not short-circuit.
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function decision(operation: AgentOperation, request: z.output<typeof AgentRequestSchema>) {
  if (operation === "applications.approve") {
    const secret = process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET;
    if (!secret || !secretsMatch(request.humanApprovalSecret, secret)) return { allowed: false, reason: "Explicit human approval secret is required." };
  }
  if (PII_OPERATIONS.includes(operation) && request.piiApproved !== true) return { allowed: false, reason: "Protected PII disclosure requires explicit approval." };
  return { allowed: true, reason: "Policy satisfied." };
}

/**
 * Daily quota is consumed on the first outward disclosure of an application,
 * whether that is opening a handoff or marking a submission. The limit
 * previously guarded only `mark_submitted`, which is self-reported bookkeeping,
 * so an agent that simply never called it could open unlimited handoffs.
 */
function assertDailyDisclosureAllowed(store: Store, application: StoredApplication, now: string) {
  if (application.disclosedAt) return; // Already counted; later stages are free.
  const limit = Number(process.env.RESUME_FOUNDRY_DAILY_APPLICATION_LIMIT ?? 10);
  const used = store.applications.filter((item) => item.disclosedAt && today(item.disclosedAt) === today(now)).length;
  if (!Number.isInteger(limit) || limit < 1 || used >= limit) throw new Error("Daily application limit reached.");
  application.disclosedAt = now;
}

function today(value: string) { return value.slice(0, 10); }
async function executeAgentOperationInner(raw: AgentRequest) {
  const request = AgentRequestSchema.parse(raw); const now = new Date().toISOString();
  // `loadStore()` used to run outside this guard, so an EACCES/EISDIR or a
  // corrupt store escaped to the route and returned the durable store's
  // absolute filesystem path to the caller in `error.message`.
  let store: Store;
  try { assertAgentAuditConfigured(); }
  catch { return { ok: false, operation: request.operation, error: "The authenticated agent audit is unavailable." }; }
  try { store = await loadStore(); }
  catch { return { ok: false, operation: request.operation, error: "The agent durable store is unavailable." }; }
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
      case "applications.prepare": { const job = store.jobs.find((item) => item.id === input.jobId); if (!job) throw new Error("Job not found."); const application: StoredApplication = { id: randomUUID(), jobId: job.id, state: "prepared", packet: structuredClone((input.packet ?? {}) as Record<string, unknown>), approvedAt: null, submittedAt: null, disclosedAt: null, responses: [], followUps: [] }; store.applications.push(application); result = application; resultId = application.id; break; }
      case "applications.review": { result = store.applications.find((item) => item.id === input.applicationId) ?? null; break; }
      case "applications.approve": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application || application.state !== "prepared") throw new Error("Only a prepared application can be approved."); application.state = "approved"; application.approvedAt = now; result = application; resultId = application.id; break; }
      case "applications.open_handoff": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application || application.state !== "approved") throw new Error("Approved application required."); assertDailyDisclosureAllowed(store, application, now); application.state = "handoff_opened"; result = application; resultId = application.id; break; }
      case "applications.mark_submitted": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application || !["approved", "handoff_opened"].includes(application.state)) throw new Error("Approved application required."); assertDailyDisclosureAllowed(store, application, now); application.state = "submitted"; application.submittedAt = now; result = application; resultId = application.id; break; }
      case "applications.record_response": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application) throw new Error("Application not found."); application.responses.push({ at: now, value: input.response ?? null }); result = application; resultId = application.id; break; }
      case "applications.schedule_followup": { const application = store.applications.find((item) => item.id === input.applicationId); if (!application) throw new Error("Application not found."); const dueAt = text(input.dueAt, "dueAt"); if (!Number.isFinite(new Date(dueAt).getTime())) throw new Error("dueAt must be an ISO date."); application.followUps.push(new Date(dueAt).toISOString()); result = application; resultId = application.id; break; }
      case "analytics.summary": result = { jobs: store.jobs.length, activeJobs: store.jobs.filter((job) => !job.dismissed).length, applications: store.applications.length, submitted: store.applications.filter((item) => item.submittedAt).length }; break;
    }
    addAudit(store, { actor: request.actor, operation: request.operation, allowed: true, reasonCode: "POLICY_SATISFIED", inputHash: hash(request.input), resultId }, now);
    await saveStore(store); return { ok: true, operation: request.operation, result };
  } catch (error) {
    addAudit(store, { actor: request.actor, operation: request.operation, allowed: false, reasonCode: "OPERATION_DENIED", inputHash: hash(request.input), resultId: null }, now);
    // This save previously ran unguarded inside the failure path, so a rename
    // race surfaced as an uncaught EPERM that killed the process.
    await saveStore(store).catch(() => undefined);
    return { ok: false, operation: request.operation, error: error instanceof Error ? error.message : "Operation denied." };
  }
}

let operationQueue: Promise<void> = Promise.resolve();

/**
 * Serialises every operation, first within this process and then across
 * processes.
 *
 * The in-process queue alone left the whole-file read-modify-write open to a
 * lost-update race: four concurrent processes each read the same store, all
 * four passed a daily limit of one, and three writes vanished.
 */
export async function executeAgentOperation(raw: AgentRequest) {
  const preceding = operationQueue; let release!: () => void;
  operationQueue = new Promise<void>((resolve) => { release = resolve; });
  await preceding;
  try {
    let lockPath: string | null = null;
    // An unset or relative store path is reported by the inner call, which
    // returns a generic failure rather than echoing the configured path.
    try { lockPath = `${storePath()}.lock`; } catch { lockPath = null; }
    if (!lockPath) return await executeAgentOperationInner(raw);
    return await withFileLock(lockPath, () => executeAgentOperationInner(raw));
  } finally { release(); }
}

/**
 * Reads under the same lock as writes.
 *
 * `saveStore` replaces the file by rename. An unlocked read landing in that
 * window sees ENOENT, which `loadStore` legitimately maps to an empty store for
 * the first-run case — so the audit trail would come back empty rather than
 * missing, which is the more dangerous of the two failures.
 */
export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null };
export async function queryAuditLog(options: { limit?: number; cursor?: string } = {}): Promise<AuditPage> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Audit page limit must be an integer from 1 through 100.");
  const read = async () => {
    const audit = (await loadStore()).audit;
    const start = options.cursor ? audit.findIndex((entry) => entry.id === options.cursor) + 1 : 0;
    if (options.cursor && start === 0) throw new Error("Invalid audit cursor.");
    const entries = audit.slice(start, start + limit).map((entry) => ({ ...entry }));
    return { entries, nextCursor: start + limit < audit.length ? entries.at(-1)!.id : null };
  };
  let lockPath: string | null = null;
  try { lockPath = `${storePath()}.lock`; } catch { lockPath = null; }
  return lockPath ? withFileLock(lockPath, read) : read();
}

export async function recordAgentDenial(entry: { actor: string; operation: string; reasonCode: string; input?: unknown }) {
  if (entry.actor === "unauthenticated" && entry.reasonCode === "AUTHENTICATION_REQUIRED") {
    const directory = `${storePath()}.auth-denials.${new Date().toISOString().slice(0, 10)}`;
    await mkdir(directory, { recursive: true });
    let admitted = false;
    for (let slot = 0; slot < UNAUTHENTICATED_DENIALS_PER_UTC_DAY; slot += 1) {
      try {
        const handle = await open(path.join(directory, String(slot)), "wx", 0o600);
        await handle.close();
        admitted = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    // Authentication still fails closed, but requests beyond the durable
    // daily admission bound never read or rewrite the growing audit store.
    if (!admitted) return false;
  }
  const write = async () => {
    const store = await loadStore();
    addAudit(store, { actor: entry.actor.slice(0, 200), operation: entry.operation.slice(0, 200), allowed: false, reasonCode: entry.reasonCode, inputHash: hash(entry.input ?? {}), resultId: null });
    await saveStore(store);
  };
  await withFileLock(`${storePath()}.lock`, write);
  return true;
}
