import { z } from "zod";
import { HttpLimitError, readJsonBody } from "./http-limits";
import {
  BlsObservationSeriesSchema,
  fetchBlsSeries,
  fetchOnetOccupation,
  OnetOccupationProfileSchema,
  type BlsObservationSeries,
  type OnetOccupationProfile,
} from "./labor-market";

const REQUEST_LIMIT_BYTES = 4 * 1024;
const OnetRequestSchema = z.strictObject({ occupationCode: z.string().regex(/^\d{2}-\d{4}\.\d{2}$/u) });
const BlsRequestSchema = z.strictObject({
  seriesIds: z.array(z.string().regex(/^[A-Z0-9_#-]{1,100}$/u)).min(1).max(50),
  startYear: z.number().int().min(1900).max(2200),
  endYear: z.number().int().min(1900).max(2200),
});

export interface LaborMarketProviders {
  blsAccess: "registered" | "unregistered";
  lookupOnetOccupation(code: string, signal?: AbortSignal): Promise<OnetOccupationProfile>;
  fetchBlsObservations(seriesIds: string[], startYear: number, endYear: number, signal?: AbortSignal): Promise<BlsObservationSeries[]>;
}

function parseBlsRequest(input: unknown, access: LaborMarketProviders["blsAccess"]) {
  const value = BlsRequestSchema.parse(input);
  const maxSeries = access === "registered" ? 50 : 25;
  const maxYears = access === "registered" ? 20 : 10;
  if (value.seriesIds.length > maxSeries) throw new z.ZodError([{ code: "custom", path: ["seriesIds"], message: `BLS ${access} access accepts at most ${maxSeries} series.` }]);
  if (new Set(value.seriesIds).size !== value.seriesIds.length) throw new z.ZodError([{ code: "custom", path: ["seriesIds"], message: "BLS series IDs must be unique." }]);
  if (value.startYear > value.endYear || value.endYear - value.startYear + 1 > maxYears) throw new z.ZodError([{ code: "custom", path: ["endYear"], message: `BLS ${access} access requires an ordered range of at most ${maxYears} years.` }]);
  return value;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function requestError(error: unknown): Response {
  if (error instanceof HttpLimitError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: "Request did not match the labor-market contract.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, 400);
  return json({ error: "Request could not be processed." }, 400);
}

function providerError(): Response {
  return json({ error: "Labor-market provider is unavailable or returned invalid data." }, 503);
}

export function createLaborMarketHandlers(providers: LaborMarketProviders) {
  return {
    async onet(request: Request): Promise<Response> {
      let body: z.infer<typeof OnetRequestSchema>;
      try {
        body = OnetRequestSchema.parse(await readJsonBody(request, REQUEST_LIMIT_BYTES));
      } catch (error) { return requestError(error); }
      try {
        const profile = OnetOccupationProfileSchema.parse(await providers.lookupOnetOccupation(body.occupationCode, request.signal));
        return json({ profile });
      } catch { return providerError(); }
    },
    async bls(request: Request): Promise<Response> {
      let body: z.infer<typeof BlsRequestSchema>;
      try {
        body = parseBlsRequest(await readJsonBody(request, REQUEST_LIMIT_BYTES), providers.blsAccess);
      } catch (error) { return requestError(error); }
      try {
        const series = BlsObservationSeriesSchema.array().max(50).parse(await providers.fetchBlsObservations(body.seriesIds, body.startYear, body.endYear, request.signal));
        return json({
          series,
          boundary: "BLS time-series observations are not occupational projections. Import a separately sourced projection snapshot for trend classification.",
        });
      } catch { return providerError(); }
    },
  };
}

export function createConfiguredLaborMarketProviders(environment: Record<string, string | undefined> = process.env): LaborMarketProviders {
  const registrationKey = environment.BLS_API_KEY?.trim() || undefined;
  return {
    blsAccess: registrationKey ? "registered" : "unregistered",
    async lookupOnetOccupation(code, signal) {
      const apiKey = environment.ONET_API_KEY?.trim();
      if (!apiKey) throw new Error("O*NET provider is not configured.");
      return fetchOnetOccupation(code, apiKey, fetch, new Date(), signal);
    },
    async fetchBlsObservations(seriesIds, startYear, endYear, signal) {
      return fetchBlsSeries(seriesIds, {
        startYear,
        endYear,
        registrationKey,
        signal,
      });
    },
  };
}

export const configuredLaborMarketHandlers = createLaborMarketHandlers(createConfiguredLaborMarketProviders());
