import type { JobImportInput } from "./job-inbox";
import { defaultSourcePermissions } from "./job-inbox";

type Fetcher = typeof fetch;
const TOKEN = /^[a-zA-Z0-9_-]{1,100}$/;

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function plain(html: unknown): string {
  return text(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim();
}
function iso(value: unknown): string | null { const candidate = text(value); if (!candidate) return null; const date = new Date(candidate); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function remote(value: string): "remote" | "hybrid" | "onsite" | "unspecified" { const n = value.toLowerCase(); return n.includes("remote") ? "remote" : n.includes("hybrid") ? "hybrid" : n.includes("on-site") || n.includes("onsite") ? "onsite" : "unspecified"; }

async function fetchJson(url: string, init: RequestInit, fetcher: Fetcher, attempts = 3): Promise<unknown> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetcher(url, init);
    if (response.ok) return response.json();
    if (![429, 502, 503, 504].includes(response.status) || attempt === attempts - 1) throw new Error(`Connector request failed (${response.status}).`);
    const retryAfter = Math.min(Number(response.headers.get("retry-after") ?? "0") || 0.05, 2);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
  }
  throw new Error("Connector retry budget exhausted.");
}

export async function fetchGreenhouse(boardToken: string, fetcher: Fetcher = fetch): Promise<JobImportInput[]> {
  if (!TOKEN.test(boardToken)) throw new Error("Invalid Greenhouse board token.");
  const payload = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`, {}, fetcher) as { jobs?: Record<string, unknown>[] };
  return (payload.jobs ?? []).map((job) => {
    const location = text((job.location as Record<string, unknown> | undefined)?.name);
    return { source: "greenhouse", sourceId: String(job.id ?? ""), permissions: defaultSourcePermissions("greenhouse"), company: boardToken, title: text(job.title) || "Untitled role", location, remoteStatus: remote(location), description: plain(job.content), applicationUrl: text(job.absolute_url), postedAt: iso(job.updated_at) };
  });
}

export async function fetchLever(site: string, options: { maxPages?: number; pageSize?: number; fetcher?: Fetcher } = {}): Promise<JobImportInput[]> {
  if (!TOKEN.test(site)) throw new Error("Invalid Lever site token.");
  const fetcher = options.fetcher ?? fetch, pageSize = Math.min(options.pageSize ?? 100, 100), maxPages = Math.min(options.maxPages ?? 10, 20);
  const jobs: JobImportInput[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json&skip=${page * pageSize}&limit=${pageSize}`, {}, fetcher) as Record<string, unknown>[];
    for (const job of payload) {
      const categories = (job.categories ?? {}) as Record<string, unknown>; const location = text(categories.location);
      jobs.push({ source: "lever", sourceId: text(job.id), permissions: defaultSourcePermissions("lever"), company: site, title: text(job.text) || "Untitled role", location, remoteStatus: remote(`${text(job.workplaceType)} ${location}`), description: text(job.descriptionPlain) || plain(job.description), applicationUrl: text(job.applyUrl) || text(job.hostedUrl) });
    }
    if (payload.length < pageSize) break;
  }
  return jobs;
}

export async function fetchUsaJobs(keyword: string, credentials: { apiKey: string; userAgent: string }, options: { maxPages?: number; fetcher?: Fetcher } = {}): Promise<JobImportInput[]> {
  if (!credentials.apiKey || !credentials.userAgent) throw new Error("USAJOBS credentials are not configured.");
  const fetcher = options.fetcher ?? fetch, maxPages = Math.min(options.maxPages ?? 3, 20), jobs: JobImportInput[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({ Keyword: keyword, Page: String(page), ResultsPerPage: "500" });
    const payload = await fetchJson(`https://data.usajobs.gov/api/search?${params}`, { headers: { Host: "data.usajobs.gov", "User-Agent": credentials.userAgent, "Authorization-Key": credentials.apiKey } }, fetcher) as Record<string, unknown>;
    const search = (payload.SearchResult ?? {}) as Record<string, unknown>; const items = (search.SearchResultItems ?? []) as Record<string, unknown>[];
    for (const item of items) {
      const job = (item.MatchedObjectDescriptor ?? {}) as Record<string, unknown>; const details = ((job.UserArea ?? {}) as Record<string, unknown>).Details as Record<string, unknown> | undefined;
      const location = text(job.PositionLocationDisplay);
      jobs.push({ source: "usajobs", sourceId: text(job.PositionID), permissions: defaultSourcePermissions("usajobs"), company: text(job.OrganizationName) || text(job.DepartmentName) || "U.S. Government", title: text(job.PositionTitle) || "Untitled role", location, remoteStatus: remote(location), description: [details?.JobSummary, details?.MajorDuties, details?.Requirements].map(text).filter(Boolean).join("\n\n"), applicationUrl: text(job.PositionURI), postedAt: iso(job.PublicationStartDate), closesAt: iso(job.ApplicationCloseDate) });
    }
    const count = Number(search.SearchResultCountAll ?? items.length); if (page * 500 >= count || items.length === 0) break;
  }
  return jobs;
}

export function parseForwardedJobAlert(raw: string): JobImportInput[] {
  const urls = [...raw.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((match) => match[0].replace(/[),.;]+$/, ""));
  const subject = raw.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() ?? "Forwarded job alert";
  const company = raw.match(/^(?:Company|Employer):\s*(.+)$/im)?.[1]?.trim() ?? "Unknown company";
  const body = raw.replace(/^From:.*$/gim, "").replace(/^Subject:.*$/gim, "").trim();
  if (body.length < 100) return [];
  return [{ source: "email", company, title: subject, description: body, applicationUrl: urls[0] ?? "", permissions: defaultSourcePermissions("email") }];
}
