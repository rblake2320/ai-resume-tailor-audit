import {
  JobPostingSnapshotSchema,
  type JobPostingSnapshot,
  type JobSource,
  type RemoteStatus,
  type SourcePermission,
} from "./schema";

export interface JobImportInput {
  source?: JobSource;
  sourceId?: string;
  company: string;
  title: string;
  location?: string;
  remoteStatus?: RemoteStatus;
  description: string;
  requiredQualifications?: string[];
  preferredQualifications?: string[];
  applicationUrl?: string;
  postedAt?: string | null;
  closesAt?: string | null;
  permissions?: SourcePermission;
}

export type DuplicateKey = "sourceId" | "canonicalUrl" | "companyTitleLocation" | "descriptionHash";

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function defaultSourcePermissions(source: JobSource): SourcePermission {
  const officialFeed = ["greenhouse", "lever", "usajobs"].includes(source);
  return {
    automatedIngestion: officialFeed,
    guidedHandoff: true,
    directSubmission: false,
    requiresEmployerAuthorization: source === "greenhouse" || source === "lever",
    termsUrl: source === "greenhouse" ? "https://developers.greenhouse.io/job-board.html"
      : source === "lever" ? "https://github.com/lever/postings-api"
      : source === "usajobs" ? "https://developer.usajobs.gov/api-reference/"
      : "",
    note: officialFeed ? "Official public job feed; direct submission remains disabled without separate authorization." : "User-provided import; no third-party site automation authorized.",
  };
}

export function canonicalJobUrl(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|source$|trk$|tracking)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.searchParams.sort();
  return url.toString();
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.normalize("NFKC").replace(/\r\n/g, "\n").trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createJobSnapshot(
  input: JobImportInput,
  existing: readonly JobPostingSnapshot[] = [],
  now = new Date(),
): Promise<JobPostingSnapshot> {
  const description = input.description.trim();
  const contentHash = await sha256(description);
  const source = input.source ?? "manual";
  const logicalMatches = existing.filter((job) =>
    (input.sourceId && job.source === source && normalize(job.sourceId) === normalize(input.sourceId)) ||
    (input.applicationUrl && canonicalJobUrl(job.applicationUrl) === canonicalJobUrl(input.applicationUrl)),
  );
  const latest = logicalMatches.sort((a, b) => b.revision - a.revision)[0];
  const snapshot = {
    id: crypto.randomUUID(),
    source,
    sourceId: input.sourceId?.trim() ?? "",
    permissions: input.permissions ?? defaultSourcePermissions(source),
    company: input.company.trim(),
    title: input.title.trim(),
    location: input.location?.trim() ?? "",
    remoteStatus: input.remoteStatus ?? "unspecified",
    compensation: null,
    description,
    requiredQualifications: input.requiredQualifications ?? [],
    preferredQualifications: input.preferredQualifications ?? [],
    applicationUrl: input.applicationUrl ? canonicalJobUrl(input.applicationUrl) : "",
    postedAt: input.postedAt ?? null,
    closesAt: input.closesAt ?? null,
    contentHash,
    importedAt: now.toISOString(),
    revision: latest ? latest.revision + 1 : 1,
    previousSnapshotId: latest?.id ?? null,
  };
  return JobPostingSnapshotSchema.parse(snapshot);
}

export function duplicateKeys(a: JobPostingSnapshot, b: JobPostingSnapshot): DuplicateKey[] {
  const matches: DuplicateKey[] = [];
  if (a.sourceId && b.sourceId && a.source === b.source && normalize(a.sourceId) === normalize(b.sourceId)) matches.push("sourceId");
  if (a.applicationUrl && b.applicationUrl && canonicalJobUrl(a.applicationUrl) === canonicalJobUrl(b.applicationUrl)) matches.push("canonicalUrl");
  if ([a.company, a.title, a.location].map(normalize).join("|") === [b.company, b.title, b.location].map(normalize).join("|")) matches.push("companyTitleLocation");
  if (a.contentHash === b.contentHash) matches.push("descriptionHash");
  return matches;
}

export function addJobSnapshot(
  jobs: readonly JobPostingSnapshot[],
  candidate: JobPostingSnapshot,
): { jobs: JobPostingSnapshot[]; added: boolean; duplicateOf?: string } {
  const identical = jobs.find((job) => job.contentHash === candidate.contentHash && duplicateKeys(job, candidate).length > 0);
  if (identical) return { jobs: [...jobs], added: false, duplicateOf: identical.id };
  return { jobs: [candidate, ...jobs], added: true };
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); if (row.some((cell) => cell.trim())) rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field); if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => normalize(header));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
}

function recordToInput(record: Record<string, unknown>, source: JobSource): JobImportInput {
  const get = (...keys: string[]) => keys.map((key) => record[key]).find((value) => typeof value === "string") as string | undefined;
  return {
    source,
    sourceId: get("sourceid", "source_id", "id"),
    company: get("company", "organization") ?? "Unknown company",
    title: get("title", "jobtitle", "job_title") ?? "Untitled role",
    location: get("location") ?? "",
    description: get("description", "jobdescription", "job_description", "text") ?? "",
    applicationUrl: get("applicationurl", "application_url", "url") ?? "",
  };
}

export function parseJobImport(text: string, format: "csv" | "json"): JobImportInput[] {
  if (format === "json") {
    const parsed: unknown = JSON.parse(text);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Every JSON job must be an object.");
      const normalized = Object.fromEntries(Object.entries(value).map(([key, entry]) => [normalize(key).replace(/\s+/g, "_"), entry]));
      return recordToInput(normalized, "json");
    });
  }
  return parseCsv(text).map((record) => recordToInput(record, "csv"));
}
