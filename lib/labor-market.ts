import { z } from "zod";

export const LABOR_MARKET_STALE_AFTER_MS = 3 * 366 * 24 * 60 * 60 * 1000;
const BLS_ENDPOINT = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const ONET_ENDPOINT = "https://api-v2.onetcenter.org/online/occupations";
const PROVIDER_RESPONSE_LIMIT_BYTES = 512 * 1024;

export const LaborMarketSnapshotSchema = z.strictObject({
  occupationCode: z.string().min(1),
  occupationTitle: z.string().min(1),
  geography: z.string().min(1),
  employmentLevel: z.number().nonnegative().nullable(),
  medianWage: z.number().nonnegative().nullable(),
  projectedGrowthPercent: z.number().finite().nullable(),
  annualOpenings: z.number().nonnegative().nullable(),
  replacementOpenings: z.number().nonnegative().nullable(),
  projectionStartYear: z.number().int().min(1900).max(2200).nullable(),
  projectionEndYear: z.number().int().min(1900).max(2200).nullable(),
  asOfDate: z.string().date(),
  source: z.literal("BLS"),
  sourceUrl: z.string().url(),
  uncertainty: z.string().min(1),
  retrievedAt: z.string().datetime(),
}).superRefine((value, context) => {
  if (value.projectionStartYear !== null && value.projectionEndYear !== null && value.projectionEndYear <= value.projectionStartYear) {
    context.addIssue({ code: "custom", message: "Projection end year must be after its start year.", path: ["projectionEndYear"] });
  }
  try {
    const hostname = new URL(value.sourceUrl).hostname.toLowerCase().replace(/\.$/u, "");
    if (hostname !== "bls.gov" && !hostname.endsWith(".bls.gov")) {
      context.addIssue({ code: "custom", message: "A BLS projection snapshot must link to an official bls.gov source.", path: ["sourceUrl"] });
    }
  } catch { /* z.string().url() reports the malformed URL */ }
});
export type LaborMarketSnapshot = z.infer<typeof LaborMarketSnapshotSchema>;

export const OnetOccupationProfileSchema = z.strictObject({
  kind: z.literal("occupation_profile"),
  occupationCode: z.string().regex(/^\d{2}-\d{4}\.\d{2}$/u),
  occupationTitle: z.string().min(1).max(500),
  description: z.string().max(10_000),
  source: z.literal("ONET"),
  sourceUrl: z.string().url(),
  asOfDate: z.string().date(),
  retrievedAt: z.string().datetime(),
  uncertainty: z.string().min(1),
  skills: z.array(z.string().min(1).max(500)).max(500),
  knowledge: z.array(z.string().min(1).max(500)).max(500),
  tasks: z.array(z.string().min(1).max(2_000)).max(500),
  technologies: z.array(z.string().min(1).max(500)).max(500),
});
export type OnetOccupationProfile = z.infer<typeof OnetOccupationProfileSchema>;

export const BlsObservationSeriesSchema = z.strictObject({
  kind: z.literal("observational_series"),
  source: z.literal("BLS"),
  sourceUrl: z.literal(BLS_ENDPOINT),
  seriesId: z.string().min(1).max(100),
  geography: z.string().min(1),
  asOfPeriod: z.string().regex(/^\d{4}-[A-Z]\d{2}$/u).nullable(),
  retrievedAt: z.string().datetime(),
  uncertainty: z.string().min(1),
  observations: z.array(z.strictObject({
    year: z.number().int().min(1900).max(2200),
    period: z.string().regex(/^[A-Z]\d{2}$/u),
    value: z.number().finite(),
    footnotes: z.array(z.unknown()),
  })).max(20_000),
});
export type BlsObservationSeries = z.infer<typeof BlsObservationSeriesSchema>;

export type Trend = "growing" | "stable" | "transforming" | "declining" | "insufficient_data";

/** Resume Foundry policy thresholds, not BLS labels or outcome guarantees. */
export function classifyOccupationTrend(snapshot: LaborMarketSnapshot, now = new Date()): { trend: Trend; reasons: string[] } {
  const value = LaborMarketSnapshotSchema.parse(snapshot);
  const missing = [
    value.projectedGrowthPercent === null ? "projected growth rate" : null,
    value.employmentLevel === null ? "current employment level" : null,
    value.projectionStartYear === null || value.projectionEndYear === null ? "projection period" : null,
  ].filter((item): item is string => item !== null);
  if (missing.length) return { trend: "insufficient_data", reasons: [`Missing required inputs: ${missing.join(", ")}.`] };
  const sourceTime = new Date(`${value.asOfDate}T00:00:00Z`).getTime();
  if (now.getTime() - sourceTime > LABOR_MARKET_STALE_AFTER_MS) {
    return { trend: "insufficient_data", reasons: [`Source data is stale as of ${value.asOfDate}; refresh it before using a trend label.`] };
  }
  const growth = value.projectedGrowthPercent;
  if (growth === null) return { trend: "insufficient_data", reasons: ["No projected growth rate was supplied."] };
  const replacementRate = value.employmentLevel && value.replacementOpenings !== null
    ? value.replacementOpenings / value.employmentLevel * 100
    : null;
  if (growth <= -2) return { trend: "declining", reasons: [`Projected employment change is ${growth}%.`, value.annualOpenings ? `${value.annualOpenings} annual openings may still exist; decline does not mean zero opportunity.` : "Openings were not supplied."] };
  if (growth >= 5) return { trend: "growing", reasons: [`Projected employment change is ${growth}%.`, value.annualOpenings !== null ? `${value.annualOpenings} annual openings are reported.` : "Openings were not supplied."] };
  if (replacementRate !== null && replacementRate >= 5) return { trend: "transforming", reasons: [`Projected growth is ${growth}%, while replacement demand is ${replacementRate.toFixed(1)}% of current employment.`] };
  return { trend: "stable", reasons: [`Projected employment change is ${growth}%, between the policy thresholds of -2% and 5%.`] };
}

type Fetcher = typeof fetch;

async function boundedJson(response: Response, limitBytes = PROVIDER_RESPONSE_LIMIT_BYTES): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("Labor-market provider returned an unsupported content type.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limitBytes) throw new Error("Labor-market provider response exceeded the size limit.");
  if (!response.body) throw new Error("Labor-market provider returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limitBytes) {
        await reader.cancel();
        throw new Error("Labor-market provider response exceeded the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Labor-market provider returned malformed JSON."); }
}

function latestPeriod(observations: readonly { year: number; period: string }[]): string | null {
  return observations.map((row) => `${row.year}-${row.period}`).sort().at(-1) ?? null;
}

export async function fetchBlsSeries(
  seriesIds: string[],
  options: { startYear: number; endYear: number; registrationKey?: string; fetcher?: Fetcher; retrievedAt?: Date },
): Promise<BlsObservationSeries[]> {
  if (!seriesIds.length || seriesIds.length > 50) throw new Error("BLS request requires 1-50 series IDs.");
  if (!seriesIds.every((id) => /^[A-Za-z0-9._-]{1,100}$/u.test(id))) throw new Error("BLS series ID is invalid.");
  if (!Number.isInteger(options.startYear) || !Number.isInteger(options.endYear) || options.startYear > options.endYear || options.endYear - options.startYear > 20) {
    throw new Error("BLS request requires an integer year range no wider than 20 years.");
  }
  const response = await (options.fetcher ?? fetch)(BLS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      seriesid: seriesIds,
      startyear: String(options.startYear),
      endyear: String(options.endYear),
      registrationkey: options.registrationKey || undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`BLS API request failed (${response.status}).`);
  const payload = await boundedJson(response) as { status?: string; Results?: { series?: { seriesID?: string; data?: { year?: string; period?: string; value?: string; footnotes?: unknown[] }[] }[] } };
  if (payload.status !== "REQUEST_SUCCEEDED") throw new Error("BLS API did not accept the request.");
  return (payload.Results?.series ?? []).map((series) => {
    const observations = (series.data ?? []).map((row) => ({
      year: Number(row.year),
      period: String(row.period),
      value: Number(row.value),
      footnotes: Array.isArray(row.footnotes) ? row.footnotes : [],
    }));
    return BlsObservationSeriesSchema.parse({
      kind: "observational_series",
      source: "BLS",
      sourceUrl: BLS_ENDPOINT,
      seriesId: String(series.seriesID),
      geography: "As defined by the BLS series metadata; verify before use.",
      asOfPeriod: latestPeriod(observations),
      retrievedAt: (options.retrievedAt ?? new Date()).toISOString(),
      uncertainty: "This endpoint returns BLS time-series observations, not occupational projections. Verify the series definition, units, period, revisions, and geography before making decisions.",
      observations,
    });
  });
}

function collectStrings(value: unknown, keys: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const result = value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    for (const key of keys) if (typeof record[key] === "string") return [record[key] as string];
    return [];
  }).map((item) => item.trim()).filter(Boolean);
  return [...new Set(result)].slice(0, 500);
}

export async function fetchOnetOccupation(
  code: string,
  credentials: { username: string; password: string },
  fetcher: Fetcher = fetch,
  retrievedAt = new Date(),
): Promise<OnetOccupationProfile> {
  if (!/^\d{2}-\d{4}\.\d{2}$/u.test(code)) throw new Error("O*NET occupation code is invalid.");
  if (!credentials.username || !credentials.password) throw new Error("O*NET Web Services credentials are required.");
  const response = await fetcher(`${ONET_ENDPOINT}/${encodeURIComponent(code)}/summary`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`O*NET request failed (${response.status}).`);
  const value = await boundedJson(response) as Record<string, unknown>;
  if (typeof value.updated !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value.updated)) throw new Error("O*NET response omitted a valid source update date.");
  const title = typeof value.title === "string" ? value.title : typeof value.occupation_title === "string" ? value.occupation_title : "";
  return OnetOccupationProfileSchema.parse({
    kind: "occupation_profile",
    source: "ONET",
    sourceUrl: `https://www.onetonline.org/link/summary/${code}`,
    occupationCode: code,
    occupationTitle: title,
    description: typeof value.description === "string" ? value.description : "",
    retrievedAt: retrievedAt.toISOString(),
    asOfDate: value.updated,
    uncertainty: "O*NET describes occupational characteristics; it does not guarantee an individual's fit, eligibility, hiring, wage, or outcome.",
    skills: collectStrings(value.skills, ["name", "title", "element_name"]),
    knowledge: collectStrings(value.knowledge, ["name", "title", "element_name"]),
    tasks: collectStrings(value.tasks, ["task", "description", "name"]),
    technologies: collectStrings(value.technology_skills ?? value.technologies, ["example", "name", "title", "commodity_title"]),
  });
}

export const TrainingResourceSchema = z.strictObject({
  id: z.string().min(1), title: z.string().min(1), provider: z.string().min(1), sourceUrl: z.string().url(),
  skills: z.array(z.string().min(1)), cost: z.strictObject({ amount: z.number().nonnegative().nullable(), currency: z.string().length(3), note: z.string() }),
  durationHours: z.number().nonnegative().nullable(), prerequisites: z.array(z.string()), accessibility: z.array(z.string()), accreditation: z.string(), evidenceQuality: z.enum(["official", "accredited", "provider_claim", "community"]), asOfDate: z.string().date(),
});
export type TrainingResource = z.infer<typeof TrainingResourceSchema>;

export function recommendTraining(gaps: readonly string[], resources: readonly TrainingResource[], now = new Date()) {
  const normalized = new Set(gaps.map((gap) => gap.normalize("NFKC").toLocaleLowerCase().trim()).filter(Boolean));
  return resources.map((candidate) => {
    const resource = TrainingResourceSchema.parse(candidate);
    const sourceTime = new Date(`${resource.asOfDate}T00:00:00Z`).getTime();
    if (sourceTime > now.getTime() + 24 * 60 * 60 * 1000 || now.getTime() - sourceTime > LABOR_MARKET_STALE_AFTER_MS) return null;
    const matchedGaps = resource.skills.filter((skill) => normalized.has(skill.normalize("NFKC").toLocaleLowerCase().trim()));
    const evidenceWeight = { official: 4, accredited: 3, provider_claim: 2, community: 1 }[resource.evidenceQuality];
    return {
      resource,
      matchedGaps,
      score: matchedGaps.length * 10 + evidenceWeight,
      rationale: matchedGaps.length ? `Addresses explicit evidence gaps: ${matchedGaps.join(", ")}.` : "Does not address an explicit evidence gap.",
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null && item.matchedGaps.length > 0).sort((a, b) => b.score - a.score || (a.resource.cost.amount ?? Infinity) - (b.resource.cost.amount ?? Infinity));
}

export const CareerPathRecordSchema = z.strictObject({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  profile: OnetOccupationProfileSchema,
  projection: LaborMarketSnapshotSchema,
  trend: z.strictObject({ trend: z.enum(["growing", "stable", "transforming", "declining"]), reasons: z.array(z.string()) }),
  evidenceGaps: z.array(z.string().min(1)).max(100),
  trainingRecommendations: z.array(z.strictObject({
    resource: TrainingResourceSchema,
    matchedGaps: z.array(z.string()),
    score: z.number().finite(),
    rationale: z.string(),
  })).max(500),
});
export type CareerPathRecord = z.infer<typeof CareerPathRecordSchema>;

export function parseCurrentProjectionSnapshot(input: unknown, now = new Date()): LaborMarketSnapshot {
  const snapshot = LaborMarketSnapshotSchema.parse(input);
  const sourceTime = new Date(`${snapshot.asOfDate}T00:00:00Z`).getTime();
  const retrievedTime = new Date(snapshot.retrievedAt).getTime();
  if (sourceTime > now.getTime() + 24 * 60 * 60 * 1000) throw new Error(`Source date ${snapshot.asOfDate} is in the future.`);
  if (retrievedTime > now.getTime() + 5 * 60 * 1000) throw new Error("Projection retrieval time is in the future.");
  const classification = classifyOccupationTrend(snapshot, now);
  if (classification.trend === "insufficient_data") throw new Error(classification.reasons.join(" "));
  return snapshot;
}

export function createCareerPathRecord(options: {
  profile: OnetOccupationProfile;
  projection: LaborMarketSnapshot;
  evidenceGaps: readonly string[];
  trainingResources: readonly TrainingResource[];
  now?: Date;
  id?: string;
}): CareerPathRecord {
  const now = options.now ?? new Date();
  const projection = parseCurrentProjectionSnapshot(options.projection, now);
  const profileCode = options.profile.occupationCode.replace(/\.\d{2}$/u, "");
  const projectionCode = projection.occupationCode.replace(/\.\d{2}$/u, "");
  if (profileCode !== projectionCode) throw new Error("O*NET profile and projection occupation codes do not match.");
  const classification = classifyOccupationTrend(projection, now);
  if (classification.trend === "insufficient_data") throw new Error(classification.reasons.join(" "));
  return CareerPathRecordSchema.parse({
    id: options.id ?? crypto.randomUUID(),
    createdAt: now.toISOString(),
    profile: OnetOccupationProfileSchema.parse(options.profile),
    projection,
    trend: classification,
    evidenceGaps: [...new Set(options.evidenceGaps.map((gap) => gap.trim()).filter(Boolean))],
    trainingRecommendations: recommendTraining(options.evidenceGaps, options.trainingResources, now),
  });
}
