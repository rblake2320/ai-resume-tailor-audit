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
  seriesIds: z.array(z.string().regex(/^[A-Za-z0-9._-]{1,100}$/u)).min(1).max(50),
  startYear: z.number().int().min(1900).max(2200),
  endYear: z.number().int().min(1900).max(2200),
}).refine((value) => value.startYear <= value.endYear && value.endYear - value.startYear <= 20, {
  message: "BLS year range must be ordered and no wider than 20 years.",
});

export interface LaborMarketProviders {
  lookupOnetOccupation(code: string): Promise<OnetOccupationProfile>;
  fetchBlsObservations(seriesIds: string[], startYear: number, endYear: number): Promise<BlsObservationSeries[]>;
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
        const profile = OnetOccupationProfileSchema.parse(await providers.lookupOnetOccupation(body.occupationCode));
        return json({ profile });
      } catch { return providerError(); }
    },
    async bls(request: Request): Promise<Response> {
      let body: z.infer<typeof BlsRequestSchema>;
      try {
        body = BlsRequestSchema.parse(await readJsonBody(request, REQUEST_LIMIT_BYTES));
      } catch (error) { return requestError(error); }
      try {
        const series = BlsObservationSeriesSchema.array().max(50).parse(await providers.fetchBlsObservations(body.seriesIds, body.startYear, body.endYear));
        return json({
          series,
          boundary: "BLS time-series observations are not occupational projections. Import a separately sourced projection snapshot for trend classification.",
        });
      } catch { return providerError(); }
    },
  };
}

export function createConfiguredLaborMarketProviders(environment: Record<string, string | undefined> = process.env): LaborMarketProviders {
  return {
    async lookupOnetOccupation(code) {
      const apiKey = environment.ONET_API_KEY?.trim();
      if (!apiKey) throw new Error("O*NET provider is not configured.");
      return fetchOnetOccupation(code, apiKey);
    },
    async fetchBlsObservations(seriesIds, startYear, endYear) {
      return fetchBlsSeries(seriesIds, {
        startYear,
        endYear,
        registrationKey: environment.BLS_API_KEY?.trim() || undefined,
      });
    },
  };
}

export const configuredLaborMarketHandlers = createLaborMarketHandlers(createConfiguredLaborMarketProviders());
