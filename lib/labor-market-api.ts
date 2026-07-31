import { z } from "zod";
import {
  fetchBlsSeries,
  fetchOnetOccupation,
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

class RequestBoundaryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new RequestBoundaryError("Content-Type must be application/json.", 415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > REQUEST_LIMIT_BYTES) throw new RequestBoundaryError("Request body is too large.", 413);
  if (!request.body) throw new RequestBoundaryError("Request body is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REQUEST_LIMIT_BYTES) {
        await reader.cancel();
        throw new RequestBoundaryError("Request body is too large.", 413);
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
  catch { throw new RequestBoundaryError("Request body must contain valid JSON.", 400); }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function routeError(error: unknown): Response {
  if (error instanceof RequestBoundaryError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: "Request did not match the labor-market contract.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, 400);
  return json({ error: error instanceof Error ? error.message : "Labor-market provider failed." }, 503);
}

export function createLaborMarketHandlers(providers: LaborMarketProviders) {
  return {
    async onet(request: Request): Promise<Response> {
      try {
        const body = OnetRequestSchema.parse(await readBoundedJson(request));
        return json({ profile: await providers.lookupOnetOccupation(body.occupationCode) });
      } catch (error) { return routeError(error); }
    },
    async bls(request: Request): Promise<Response> {
      try {
        const body = BlsRequestSchema.parse(await readBoundedJson(request));
        return json({
          series: await providers.fetchBlsObservations(body.seriesIds, body.startYear, body.endYear),
          boundary: "BLS time-series observations are not occupational projections. Import a separately sourced projection snapshot for trend classification.",
        });
      } catch (error) { return routeError(error); }
    },
  };
}

export function createConfiguredLaborMarketProviders(environment: Record<string, string | undefined> = process.env): LaborMarketProviders {
  return {
    async lookupOnetOccupation(code) {
      const username = environment.ONET_USERNAME?.trim();
      const password = environment.ONET_PASSWORD?.trim();
      if (!username || !password) throw new Error("O*NET provider is not configured.");
      return fetchOnetOccupation(code, { username, password });
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
