import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GET as capabilities } from "../app/api/capabilities/route";
import {
  createLaborMarketHandlers,
  createConfiguredLaborMarketProviders,
  type LaborMarketProviders,
} from "./labor-market-api";
import {
  createCareerPathRecord,
  parseCurrentProjectionSnapshot,
  type LaborMarketSnapshot,
  type OnetOccupationProfile,
} from "./labor-market";

const onetProfile: OnetOccupationProfile = {
  kind: "occupation_profile",
  occupationCode: "15-1252.00",
  occupationTitle: "Software Developers",
  description: "Research, design, and develop software.",
  source: "ONET",
  sourceUrl: "https://www.onetonline.org/link/summary/15-1252.00",
  sourceYear: 2026,
  sourceContents: [{ title: "Occupation description", source: "Analyst", year: 2025 }],
  retrievedAt: "2026-07-31T12:00:00.000Z",
  uncertainty: "O*NET describes occupational characteristics; it does not predict hiring outcomes.",
  reportedTitles: ["Software Engineer"],
};

const projection: LaborMarketSnapshot = {
  occupationCode: "15-1252",
  occupationTitle: "Software Developers",
  geography: "United States",
  employmentLevel: 1000,
  medianWage: { amount: 120000, currency: "USD", period: "year", unit: "per worker" },
  projectedGrowthPercent: 8,
  annualOpenings: 100,
  replacementOpenings: 20,
  projectionStartYear: 2024,
  projectionEndYear: 2034,
  asOfDate: "2026-01-01",
  source: "BLS",
  sourceUrl: "https://www.bls.gov/emp/tables/occupational-projections-and-characteristics.htm",
  uncertainty: "Projection, not a guarantee.",
  retrievedAt: "2026-07-31T12:00:00.000Z",
  verification: "user_supplied_unverified",
};

function providers(): LaborMarketProviders {
  return {
    blsAccess: "unregistered",
    lookupOnetOccupation: vi.fn().mockResolvedValue(onetProfile),
    fetchBlsObservations: vi.fn().mockResolvedValue([{
      kind: "observational_series",
      source: "BLS",
      sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
      seriesId: "CES0000000001",
      geography: "As defined by the BLS series metadata; verify before use.",
      asOfPeriod: "2026-M01",
      retrievedAt: "2026-07-31T12:00:00.000Z",
      uncertainty: "Historical observations are not occupational projections.",
      observations: [{ year: 2026, period: "M01", value: 12.5, footnotes: [] }],
    }]),
  };
}

describe("labor-market product API", () => {
  it("keeps both public routes aligned across capabilities and OpenAPI", async () => {
    const capabilityBody = await capabilities().json() as { operations: Array<{ path?: string }> };
    const advertised = capabilityBody.operations.map((operation) => operation.path);
    const spec = JSON.parse(await readFile(path.resolve("public/openapi.json"), "utf8")) as {
      paths: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: { properties?: { seriesIds?: unknown } } }> } } }>;
    };
    for (const route of ["/api/labor-market/onet", "/api/labor-market/bls-series"]) {
      expect(advertised).toContain(route);
      expect(spec.paths[route]?.post).toBeDefined();
    }
    expect(spec.paths["/api/labor-market/bls-series"].post?.requestBody?.content?.["application/json"]?.schema?.properties?.seriesIds).toMatchObject({
      maxItems: 25, uniqueItems: true, items: { pattern: "^[A-Z0-9_#-]{1,100}$" },
    });
  });

  it("makes O*NET reachable through a bounded, mockable server handler without returning credentials", async () => {
    const source = providers();
    const handlers = createLaborMarketHandlers(source);
    const response = await handlers.onet(new Request("http://localhost/api/labor-market/onet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ occupationCode: "15-1252.00" }),
    }));
    expect(response.status).toBe(200);
    const serialized = await response.text();
    expect(JSON.parse(serialized)).toEqual({ profile: onetProfile });
    expect(source.lookupOnetOccupation).toHaveBeenCalledWith("15-1252.00", expect.any(AbortSignal));
    expect(serialized).not.toContain("password");
  });

  it("rejects oversized and malformed labor-market requests before provider work", async () => {
    const source = providers();
    const handlers = createLaborMarketHandlers(source);
    const oversized = await handlers.onet(new Request("http://localhost/api/labor-market/onet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ occupationCode: "15-1252.00", padding: "x".repeat(5000) }),
    }));
    expect(oversized.status).toBe(413);
    const malformed = await handlers.onet(new Request("http://localhost/api/labor-market/onet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }));
    expect(malformed.status).toBe(400);
    expect(source.lookupOnetOccupation).not.toHaveBeenCalled();
  });

  it("shares the strict request boundary for content type, declared size, streamed size, and malformed length", async () => {
    const source = providers();
    const handlers = createLaborMarketHandlers(source);
    const requests = [
      new Request("http://localhost/api/labor-market/onet", { method: "POST", body: "{}" }),
      new Request("http://localhost/api/labor-market/onet", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }),
      new Request("http://localhost/api/labor-market/onet", { method: "POST", headers: { "content-type": "application/json", "content-length": "4097" }, body: "{}" }),
      new Request("http://localhost/api/labor-market/onet", { method: "POST", headers: { "content-type": "application/json", "content-length": "not-a-number" }, body: "{}" }),
      new Request("http://localhost/api/labor-market/onet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ occupationCode: "15-1252.00", padding: "x".repeat(5000) }) }),
    ];
    const expected = [415, 415, 413, 400, 413];
    for (const [index, request] of requests.entries()) expect((await handlers.onet(request)).status).toBe(expected[index]);
    expect(source.lookupOnetOccupation).not.toHaveBeenCalled();
  });

  it("labels BLS time-series output as observations, never as occupational projections", async () => {
    const source = providers();
    const handlers = createLaborMarketHandlers(source);
    const response = await handlers.bls(new Request("http://localhost/api/labor-market/bls-series", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seriesIds: ["CES0000000001"], startYear: 2026, endYear: 2026 }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.series[0]).toMatchObject({ kind: "observational_series", seriesId: "CES0000000001" });
    expect(JSON.stringify(body)).not.toContain("projectedGrowthPercent");
  });

  it("rejects requests outside the configured BLS tier before provider work", async () => {
    const source = providers();
    const handler = createLaborMarketHandlers(source).bls;
    const request = (value: unknown) => new Request("http://localhost/api/labor-market/bls-series", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
    });
    for (const value of [
      { seriesIds: ["lowercase"], startYear: 2026, endYear: 2026 },
      { seriesIds: ["SERIES1", "SERIES1"], startYear: 2026, endYear: 2026 },
      { seriesIds: Array.from({ length: 26 }, (_, index) => `SERIES${index}`), startYear: 2026, endYear: 2026 },
      { seriesIds: ["SERIES1"], startYear: 2016, endYear: 2026 },
    ]) expect((await handler(request(value))).status).toBe(400);
    expect(source.fetchBlsObservations).not.toHaveBeenCalled();
  });

  it("passes the incoming request abort signal to provider work", async () => {
    const source = providers();
    const controller = new AbortController();
    const request = new Request("http://localhost/api/labor-market/onet", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ occupationCode: "15-1252.00" }), signal: controller.signal,
    });
    const response = await createLaborMarketHandlers(source).onet(request);
    expect(response.status).toBe(200);
    expect(source.lookupOnetOccupation).toHaveBeenCalledWith("15-1252.00", request.signal);
  });

  it("fails closed when O*NET credentials are absent instead of pretending the provider is ready", async () => {
    const configured = createConfiguredLaborMarketProviders({});
    await expect(configured.lookupOnetOccupation("15-1252.00")).rejects.toThrow(/not configured/i);
  });

  it("schema-validates provider output and returns a stable public error without leaking upstream detail", async () => {
    const source = providers();
    vi.mocked(source.lookupOnetOccupation).mockResolvedValueOnce({ ...onetProfile, sourceYear: "secret upstream detail" } as never);
    const response = await createLaborMarketHandlers(source).onet(new Request("http://localhost/api/labor-market/onet", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ occupationCode: "15-1252.00" }),
    }));
    expect(response.status).toBe(503);
    const serialized = await response.text();
    expect(serialized).toContain("provider is unavailable or returned invalid data");
    expect(serialized).not.toContain("secret upstream detail");
  });
});

describe("career-path records", () => {
  it("preserves source, geography, dates, projection interval, retrieval time, and uncertainty", () => {
    const parsed = parseCurrentProjectionSnapshot(projection, new Date("2026-07-31T12:00:00Z"));
    const record = createCareerPathRecord({
      profile: onetProfile,
      projection: parsed,
      evidenceGaps: ["network security"],
      trainingResources: [{
        id: "course-1",
        title: "Network security",
        provider: "Example College",
        sourceUrl: "https://example.edu/security",
        skills: ["network security"],
        cost: { amount: 200, currency: "USD", note: "Published tuition" },
        durationHours: 40,
        prerequisites: [],
        accessibility: ["captions"],
        accreditation: "Regional",
        evidenceQuality: "accredited",
        asOfDate: "2026-01-01",
        verification: "user_supplied_unverified",
      }],
      now: new Date("2026-07-31T12:00:00Z"),
      id: "path-1",
    });
    expect(record.projection).toEqual(projection);
    expect(record.projection).toMatchObject({
      geography: "United States",
      projectionStartYear: 2024,
      projectionEndYear: 2034,
      sourceUrl: projection.sourceUrl,
      asOfDate: "2026-01-01",
      retrievedAt: "2026-07-31T12:00:00.000Z",
      uncertainty: "Projection, not a guarantee.",
    });
    expect(record.trainingRecommendations).toHaveLength(1);
    expect(record.trainingRecommendations[0].matchedGaps).toEqual(["network security"]);
  });

  it("refuses missing or stale projection evidence rather than assigning a confident trend", () => {
    const now = new Date("2026-07-31T13:00:00Z");
    expect(() => parseCurrentProjectionSnapshot({ ...projection, employmentLevel: null }, now)).toThrow(/missing required/i);
    expect(() => parseCurrentProjectionSnapshot({ ...projection, asOfDate: "1999-01-01" }, now)).toThrow(/stale/i);
    expect(() => parseCurrentProjectionSnapshot({ ...projection, asOfDate: "2027-01-01" }, now)).toThrow(/future/i);
  });

  it("cannot pair an O*NET profile with a different occupation's projection", () => {
    expect(() => createCareerPathRecord({
      profile: onetProfile,
      projection: { ...projection, occupationCode: "29-1141" },
      evidenceGaps: [],
      trainingResources: [],
      now: new Date("2026-07-31T12:00:00Z"),
    })).toThrow(/occupation code/i);
  });

  it("rejects non-HTTPS provenance and training links before rendering them", () => {
    expect(() => parseCurrentProjectionSnapshot({ ...projection, sourceUrl: "http://www.bls.gov/emp/" }, new Date("2026-07-31T13:00:00Z"))).toThrow(/HTTPS/i);
    expect(() => createCareerPathRecord({
      profile: onetProfile,
      projection,
      evidenceGaps: ["network security"],
      trainingResources: [{ id: "bad", title: "Bad link", provider: "Unknown", sourceUrl: "javascript:alert(1)", skills: ["network security"], cost: { amount: null, currency: "USD", note: "" }, durationHours: null, prerequisites: [], accessibility: [], accreditation: "", evidenceQuality: "provider_claim", asOfDate: "2026-01-01", verification: "user_supplied_unverified" }],
      now: new Date("2026-07-31T13:00:00Z"),
    })).toThrow(/HTTPS|URL/i);
  });
});
