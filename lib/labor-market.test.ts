import { describe, expect, it, vi } from "vitest";
import { classifyOccupationTrend, fetchBlsSeries, fetchOnetOccupation, recommendTraining, type LaborMarketSnapshot, type TrainingResource } from "./labor-market";

const snapshot = (growth: number | null, overrides: Partial<LaborMarketSnapshot> = {}): LaborMarketSnapshot => ({ occupationCode: "15-1252", occupationTitle: "Software Developers", geography: "United States", employmentLevel: 1000, medianWage: 120000, projectedGrowthPercent: growth, annualOpenings: 100, replacementOpenings: 20, projectionStartYear: 2024, projectionEndYear: 2034, asOfDate: "2026-01-01", source: "BLS", sourceUrl: "https://www.bls.gov/emp/", uncertainty: "Projection, not a guarantee.", retrievedAt: "2026-01-01T00:00:00Z", ...overrides });
describe("labor-market path intelligence", () => {
  it("distinguishes growth, decline, stability, transformation, and missing data", () => {
    const now = new Date("2026-07-31T00:00:00Z");
    expect(classifyOccupationTrend(snapshot(8), now).trend).toBe("growing"); expect(classifyOccupationTrend(snapshot(-3), now).trend).toBe("declining");
    expect(classifyOccupationTrend(snapshot(3, { replacementOpenings: 10 }), now).trend).toBe("stable"); expect(classifyOccupationTrend(snapshot(3, { replacementOpenings: 100 }), now).trend).toBe("transforming");
    expect(classifyOccupationTrend(snapshot(null), now).trend).toBe("insufficient_data"); expect(classifyOccupationTrend(snapshot(-3), now).reasons.join(" ")).toContain("still exist");
    expect(classifyOccupationTrend(snapshot(3, { employmentLevel: null }), now).trend).toBe("insufficient_data");
    expect(classifyOccupationTrend(snapshot(8, { asOfDate: "1999-01-01" }), now)).toMatchObject({ trend: "insufficient_data" });
  });
  it("preserves BLS series provenance, geography warning, as-of date, and observations", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: { series: [{ seriesID: "TEST", data: [{ year: "2026", period: "M01", value: "12.5", footnotes: [] }] }] } }), { status: 200 }));
    const result = await fetchBlsSeries(["TEST"], { startYear: 2026, endYear: 2026, fetcher, retrievedAt: new Date("2026-02-01T00:00:00Z") });
    expect(result[0]).toMatchObject({ kind: "observational_series", source: "BLS", seriesId: "TEST", asOfPeriod: "2026-M01", geography: "As defined by the BLS series metadata; verify before use.", retrievedAt: "2026-02-01T00:00:00.000Z" });
  });
  it("authenticates O*NET requests server-side and preserves provenance", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "Developer", updated: "2026-01-15" }), { status: 200 }));
    const result = await fetchOnetOccupation("15-1252.00", { username: "user", password: "secret" }, fetcher);
    expect(result).toMatchObject({ source: "ONET", occupationCode: "15-1252.00", asOfDate: "2026-01-15" });
    expect(JSON.stringify(result)).not.toContain("secret"); expect((fetcher.mock.calls[0][1] as RequestInit).headers).toHaveProperty("authorization");
    const missingDate = vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "Developer" }), { status: 200 }));
    await expect(fetchOnetOccupation("15-1252.00", { username: "user", password: "secret" }, missingDate)).rejects.toThrow(/update date/);
    const oversized = vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: "Developer", updated: "2026-01-15", padding: "x".repeat(600_000) }), { status: 200 }));
    await expect(fetchOnetOccupation("15-1252.00", { username: "user", password: "secret" }, oversized)).rejects.toThrow(/size limit/);
    expect((fetcher.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
  it("ranks training only when it maps to an explicit evidence gap", () => {
    const resources: TrainingResource[] = [{ id: "r1", title: "Security course", provider: "Community college", sourceUrl: "https://example.edu/security", skills: ["network security"], cost: { amount: 200, currency: "USD", note: "Published tuition" }, durationHours: 40, prerequisites: ["Networking basics"], accessibility: ["captions"], accreditation: "Regional", evidenceQuality: "accredited", asOfDate: "2026-01-01" }, { id: "r2", title: "Unrelated", provider: "Provider", sourceUrl: "https://example.com/other", skills: ["pottery"], cost: { amount: 0, currency: "USD", note: "Free" }, durationHours: 2, prerequisites: [], accessibility: [], accreditation: "", evidenceQuality: "provider_claim", asOfDate: "2026-01-01" }];
    const ranked = recommendTraining(["network security"], resources); expect(ranked).toHaveLength(1); expect(ranked[0].rationale).toContain("network security"); expect(ranked[0].resource.prerequisites).toEqual(["Networking basics"]);
    expect(recommendTraining(["network security"], [{ ...resources[0], asOfDate: "1999-01-01" }], new Date("2026-07-31"))).toEqual([]);
  });
});
