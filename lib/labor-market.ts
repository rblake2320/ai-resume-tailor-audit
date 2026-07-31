import { z } from "zod";

export const LaborMarketSnapshotSchema = z.strictObject({
  occupationCode: z.string().min(1), occupationTitle: z.string().min(1), geography: z.string().min(1),
  employmentLevel: z.number().nonnegative().nullable(), medianWage: z.number().nonnegative().nullable(),
  projectedGrowthPercent: z.number().finite().nullable(), annualOpenings: z.number().nonnegative().nullable(),
  replacementOpenings: z.number().nonnegative().nullable(), projectionStartYear: z.number().int().nullable(), projectionEndYear: z.number().int().nullable(),
  asOfDate: z.string().date(), source: z.enum(["BLS", "ONET"]), sourceUrl: z.string().url(),
  uncertainty: z.string().min(1), retrievedAt: z.string().datetime(),
});
export type LaborMarketSnapshot = z.infer<typeof LaborMarketSnapshotSchema>;
export type Trend = "growing" | "stable" | "transforming" | "declining" | "insufficient_data";

/** Documented policy thresholds, not BLS labels or outcome guarantees. */
export function classifyOccupationTrend(snapshot: LaborMarketSnapshot): { trend: Trend; reasons: string[] } {
  const value = LaborMarketSnapshotSchema.parse(snapshot); const growth = value.projectedGrowthPercent;
  if (growth === null) return { trend: "insufficient_data", reasons: ["No projected growth rate was supplied."] };
  const replacementRate = value.employmentLevel && value.replacementOpenings !== null ? value.replacementOpenings / value.employmentLevel * 100 : null;
  if (growth <= -2) return { trend: "declining", reasons: [`Projected employment change is ${growth}%.`, value.annualOpenings ? `${value.annualOpenings} annual openings may still exist; decline does not mean zero opportunity.` : "Openings were not supplied." ] };
  if (growth >= 5) return { trend: "growing", reasons: [`Projected employment change is ${growth}%.`, value.annualOpenings !== null ? `${value.annualOpenings} annual openings are reported.` : "Openings were not supplied."] };
  if (replacementRate !== null && replacementRate >= 5) return { trend: "transforming", reasons: [`Projected growth is ${growth}%, while replacement demand is ${replacementRate.toFixed(1)}% of current employment.`] };
  return { trend: "stable", reasons: [`Projected employment change is ${growth}%, between the policy thresholds of -2% and 5%.`] };
}

type Fetcher = typeof fetch;
export async function fetchBlsSeries(seriesIds: string[], options: { startYear: number; endYear: number; registrationKey?: string; fetcher?: Fetcher; retrievedAt?: Date }) {
  if (!seriesIds.length || seriesIds.length > 50) throw new Error("BLS request requires 1-50 series IDs.");
  const fetcher = options.fetcher ?? fetch; const response = await fetcher("https://api.bls.gov/publicAPI/v2/timeseries/data/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seriesid: seriesIds, startyear: String(options.startYear), endyear: String(options.endYear), registrationkey: options.registrationKey || undefined }) });
  if (!response.ok) throw new Error(`BLS API request failed (${response.status}).`);
  const payload = await response.json() as { status?: string; Results?: { series?: { seriesID?: string; data?: { year?: string; period?: string; value?: string; footnotes?: unknown[] }[] }[] } };
  if (payload.status !== "REQUEST_SUCCEEDED") throw new Error("BLS API did not accept the request.");
  return (payload.Results?.series ?? []).map((series) => ({ source: "BLS" as const, sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/", seriesId: String(series.seriesID),
    geography: "As defined by BLS series", asOfDate: `${options.endYear}-12-31`, retrievedAt: (options.retrievedAt ?? new Date()).toISOString(),
    uncertainty: "BLS observations and projections are estimates; series definitions, revisions, period, and geography must be reviewed before decisions.",
    observations: (series.data ?? []).map((row) => ({ year: Number(row.year), period: String(row.period), value: Number(row.value), footnotes: row.footnotes ?? [] })) }));
}

export async function fetchOnetOccupation(code: string, credentials: { username: string; password: string }, fetcher: Fetcher = fetch) {
  if (!/^\d{2}-\d{4}\.\d{2}$/u.test(code)) throw new Error("O*NET occupation code is invalid.");
  if (!credentials.username || !credentials.password) throw new Error("O*NET Web Services credentials are required.");
  const response = await fetcher(`https://api-v2.onetcenter.org/online/occupations/${encodeURIComponent(code)}/summary`, { headers: { authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`, accept: "application/json" } });
  if (!response.ok) throw new Error(`O*NET request failed (${response.status}).`);
  const value = await response.json() as Record<string, unknown>;
  return { source: "ONET" as const, sourceUrl: `https://www.onetonline.org/link/summary/${code}`, occupationCode: code, retrievedAt: new Date().toISOString(),
    asOfDate: typeof value.updated === "string" ? value.updated : new Date().toISOString().slice(0, 10),
    uncertainty: "O*NET describes occupational characteristics; it does not guarantee an individual's fit, eligibility, hiring, wage, or outcome.", data: value };
}

export const TrainingResourceSchema = z.strictObject({
  id: z.string().min(1), title: z.string().min(1), provider: z.string().min(1), sourceUrl: z.string().url(),
  skills: z.array(z.string().min(1)), cost: z.strictObject({ amount: z.number().nonnegative().nullable(), currency: z.string().length(3), note: z.string() }),
  durationHours: z.number().nonnegative().nullable(), prerequisites: z.array(z.string()), accessibility: z.array(z.string()), accreditation: z.string(), evidenceQuality: z.enum(["official", "accredited", "provider_claim", "community"]), asOfDate: z.string().date(),
});
export type TrainingResource = z.infer<typeof TrainingResourceSchema>;
export function recommendTraining(gaps: readonly string[], resources: readonly TrainingResource[]) {
  const normalized = new Set(gaps.map((gap) => gap.toLowerCase()));
  return resources.map((resource) => {
    const matchedGaps = resource.skills.filter((skill) => normalized.has(skill.toLowerCase()));
    const evidenceWeight = { official: 4, accredited: 3, provider_claim: 2, community: 1 }[resource.evidenceQuality];
    return { resource: TrainingResourceSchema.parse(resource), matchedGaps, score: matchedGaps.length * 10 + evidenceWeight,
      rationale: matchedGaps.length ? `Addresses explicit evidence gaps: ${matchedGaps.join(", ")}.` : "Does not address an explicit evidence gap." };
  }).filter((item) => item.matchedGaps.length).sort((a, b) => b.score - a.score || (a.resource.cost.amount ?? Infinity) - (b.resource.cost.amount ?? Infinity));
}
