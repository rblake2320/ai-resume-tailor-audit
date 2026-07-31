import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { classifyOccupationTrend, fetchBlsSeries, fetchOnetOccupation, recommendTraining, type LaborMarketSnapshot, type TrainingResource } from "./labor-market";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./testdata/${name}`, import.meta.url), "utf8"));
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const snapshot = (growth: number | null, overrides: Partial<LaborMarketSnapshot> = {}): LaborMarketSnapshot => ({
  occupationCode: "15-1252", occupationTitle: "Software Developers", geography: "United States", employmentLevel: 1000,
  medianWage: { amount: 120000, currency: "USD", period: "year", unit: "per worker" }, projectedGrowthPercent: growth,
  annualOpenings: 100, replacementOpenings: 20, projectionStartYear: 2024, projectionEndYear: 2034, asOfDate: "2026-01-01",
  source: "BLS", sourceUrl: "https://www.bls.gov/emp/", uncertainty: "Projection, not a guarantee.", retrievedAt: "2026-01-01T00:00:00Z",
  verification: "user_supplied_unverified", ...overrides,
});

describe("labor-market path intelligence", () => {
  it("distinguishes growth, decline, stability, transformation, and missing data", () => {
    const now = new Date("2026-07-31T00:00:00Z");
    expect(classifyOccupationTrend(snapshot(8), now).trend).toBe("growing");
    expect(classifyOccupationTrend(snapshot(-3), now).trend).toBe("declining");
    expect(classifyOccupationTrend(snapshot(3, { replacementOpenings: 10 }), now).trend).toBe("stable");
    expect(classifyOccupationTrend(snapshot(3, { replacementOpenings: 100 }), now).trend).toBe("transforming");
    expect(classifyOccupationTrend(snapshot(null), now).trend).toBe("insufficient_data");
    expect(classifyOccupationTrend(snapshot(-3), now).reasons.join(" ")).toContain("still exist");
    expect(classifyOccupationTrend(snapshot(3, { employmentLevel: null }), now).trend).toBe("insufficient_data");
    expect(classifyOccupationTrend(snapshot(8, { asOfDate: "1999-01-01" }), now)).toMatchObject({ trend: "insufficient_data" });
  });

  it("uses the official O*NET v2 overview endpoint, X-API-Key, and updated object without inventing subresource data", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(fixture("onet-occupation-overview.json")));
    const result = await fetchOnetOccupation("15-1252.00", "server-api-key", fetcher, new Date("2026-07-31T12:00:00Z"));
    expect(result).toMatchObject({ source: "ONET", occupationCode: "15-1252.00", sourceYear: 2026, reportedTitles: ["Application Developer", "Software Engineer"] });
    expect(result.sourceContents).toHaveLength(2);
    expect(result).not.toHaveProperty("skills");
    expect(fetcher).toHaveBeenCalledWith("https://api-v2.onetcenter.org/online/occupations/15-1252.00/", expect.objectContaining({ headers: expect.objectContaining({ "X-API-Key": "server-api-key" }) }));
    expect(JSON.stringify(fetcher.mock.calls[0][1])).not.toContain("Basic");
  });

  it("rejects O*NET identity mismatches, accepts omitted update provenance, and bounds responses", async () => {
    const official = fixture("onet-occupation-overview.json");
    await expect(fetchOnetOccupation("15-1252.00", "key", vi.fn().mockResolvedValue(jsonResponse({ ...official, code: "29-1141.00" })))).rejects.toThrow(/code/i);
    await expect(fetchOnetOccupation("15-1252.00", "key", vi.fn().mockResolvedValue(jsonResponse({ ...official, updated: undefined })))).resolves.toMatchObject({
      sourceYear: null, sourceContents: [], uncertainty: expect.stringMatching(/did not report source-update provenance/i),
    });
    await expect(fetchOnetOccupation("15-1252.00", "key", vi.fn().mockResolvedValue(jsonResponse({ ...official, padding: "x".repeat(600_000) })))).rejects.toThrow(/size limit/);
  });

  it("fails closed on provider content type, declared/streamed size, malformed length, and abort", async () => {
    await expect(fetchOnetOccupation("15-1252.00", "key", vi.fn().mockResolvedValue(
      new Response("{}", { headers: { "content-type": "text/html" } }),
    ))).rejects.toThrow(/content type/i);
    await expect(fetchOnetOccupation("15-1252.00", "key", vi.fn().mockResolvedValue(
      new Response("{}", { headers: { "content-type": "application/json", "content-length": "600000" } }),
    ))).rejects.toThrow(/size limit/i);
    await expect(fetchOnetOccupation("15-1252.00", "key", vi.fn().mockResolvedValue(
      new Response("{}", { headers: { "content-type": "application/json", "content-length": "NaN" } }),
    ))).rejects.toThrow(/invalid length/i);
    await expect(fetchOnetOccupation("15-1252.00", "key", vi.fn().mockResolvedValue(
      new Response("x".repeat(600_000), { headers: { "content-type": "application/json" } }),
    ))).rejects.toThrow(/size limit/i);
    const aborted = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("provider timed out", "AbortError");
    });
    await expect(fetchOnetOccupation("15-1252.00", "key", aborted as typeof fetch)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates caller aborts and cancels bodies rejected before parsing", async () => {
    const caller = new AbortController();
    const upstreamSignals: AbortSignal[] = [];
    const pending = vi.fn((_url: string, init?: RequestInit) => {
      const upstreamSignal = init?.signal as AbortSignal;
      upstreamSignals.push(upstreamSignal);
      return new Promise<Response>((_resolve, reject) => upstreamSignal.addEventListener("abort", () => reject(upstreamSignal.reason), { once: true }));
    });
    const lookup = fetchOnetOccupation("15-1252.00", "key", pending as typeof fetch, new Date(), caller.signal);
    caller.abort(new DOMException("client disconnected", "AbortError"));
    await expect(lookup).rejects.toMatchObject({ name: "AbortError" });
    expect(upstreamSignals[0].aborted).toBe(true);

    for (const response of [
      { status: 200, contentType: "text/html" },
      { status: 502, contentType: "application/json" },
    ]) {
      const cancel = vi.fn();
      const body = new ReadableStream({ pull() { /* remains open until canceled */ }, cancel });
      await expect(fetchOnetOccupation("15-1252.00", "key", vi.fn().mockResolvedValue(new Response(body, {
        status: response.status, headers: { "content-type": response.contentType },
      })))).rejects.toThrow();
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it("preserves exact BLS observations and rejects messages, missing series, and invalid/empty rows", async () => {
    const official = fixture("bls-timeseries-response.json");
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(official));
    const result = await fetchBlsSeries(["CES0000000001"], { startYear: 2026, endYear: 2026, fetcher, retrievedAt: new Date("2026-02-01T00:00:00Z") });
    expect(result[0]).toMatchObject({ kind: "observational_series", seriesId: "CES0000000001", asOfPeriod: "2026-M01" });
    await expect(fetchBlsSeries(["CES0000000001"], { startYear: 2026, endYear: 2026, fetcher: vi.fn().mockResolvedValue(jsonResponse({ ...official, message: ["Invalid series"] })) })).rejects.toThrow(/message/i);
    await expect(fetchBlsSeries(["CES0000000001"], { startYear: 2026, endYear: 2026, fetcher: vi.fn().mockResolvedValue(jsonResponse({ ...official, Results: { series: [] } })) })).rejects.toThrow(/series/i);
    await expect(fetchBlsSeries(["CES0000000001"], { startYear: 2026, endYear: 2026, fetcher: vi.fn().mockResolvedValue(jsonResponse({ ...official, Results: { series: [{ seriesID: "CES0000000002", data: official.Results.series[0].data }] } })) })).rejects.toThrow(/requested/i);
    await expect(fetchBlsSeries(["CES0000000001"], { startYear: 2026, endYear: 2026, fetcher: vi.fn().mockResolvedValue(jsonResponse({ ...official, Results: { series: [{ seriesID: "CES0000000001", data: [] }] } })) })).rejects.toThrow(/observations/i);
    await expect(fetchBlsSeries(["CES0000000001"], { startYear: 2026, endYear: 2026, fetcher: vi.fn().mockResolvedValue(jsonResponse({ ...official, Results: { series: [{ seriesID: "CES0000000001", data: [{ year: "2026", period: "M01", value: "NaN", footnotes: [] }] }] } })) })).rejects.toThrow(/data/i);
  });

  it("enforces BLS registered 50/20 and unregistered 25/10 request limits", async () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `SERIES${String(index).padStart(2, "0")}`);
    await expect(fetchBlsSeries(ids(26), { startYear: 2017, endYear: 2026, fetcher: vi.fn() })).rejects.toThrow(/25/);
    await expect(fetchBlsSeries(ids(25), { startYear: 2016, endYear: 2026, fetcher: vi.fn() })).rejects.toThrow(/10 years/);
    const official = fixture("bls-timeseries-response.json");
    await expect(fetchBlsSeries(ids(51), { startYear: 2007, endYear: 2026, registrationKey: "registered", fetcher: vi.fn() })).rejects.toThrow(/50/);
    await expect(fetchBlsSeries(ids(50), { startYear: 2006, endYear: 2026, registrationKey: "registered", fetcher: vi.fn() })).rejects.toThrow(/20 years/);
    expect(official.status).toBe("REQUEST_SUCCEEDED");
  });

  it("ranks only current resources matching explicit gaps and never compares prices across currencies", () => {
    const base: TrainingResource = { id: "usd", title: "Alpha USD course", provider: "College", sourceUrl: "https://example.edu/security", skills: ["network security"], cost: { amount: 1000, currency: "USD", note: "Published tuition" }, durationHours: 40, prerequisites: [], accessibility: ["captions"], accreditation: "Regional", evidenceQuality: "accredited", asOfDate: "2026-01-01", verification: "user_supplied_unverified" };
    const resources: TrainingResource[] = [base, { ...base, id: "eur", title: "Zulu EUR course", cost: { ...base.cost, amount: 1, currency: "EUR" } }, { ...base, id: "unrelated", title: "Pottery", skills: ["pottery"] }];
    const ranked = recommendTraining(["network security"], resources, new Date("2026-07-31"));
    expect(ranked.map((item) => item.resource.id)).toEqual(["usd", "eur"]);
    expect(recommendTraining(["network security"], [{ ...base, asOfDate: "1999-01-01" }], new Date("2026-07-31"))).toEqual([]);
  });
});
