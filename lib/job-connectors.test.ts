import { describe, expect, it, vi } from "vitest";
import { fetchGreenhouse, fetchLever, fetchUsaJobs, parseForwardedJobAlert } from "./job-connectors";

function reply(body: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }); }

describe("official job connectors", () => {
  it("normalizes Greenhouse and strips HTML", async () => {
    const fetcher = vi.fn(async () => reply({ jobs: [{ id: 1, title: "Engineer", location: { name: "Remote" }, content: "<p>Build secure reliable systems with testing, observability, collaboration, documentation, and production ownership for customers.</p>", absolute_url: "https://example.com/1" }] })) as unknown as typeof fetch;
    const [job] = await fetchGreenhouse("acme", fetcher); expect(job).toMatchObject({ source: "greenhouse", sourceId: "1", remoteStatus: "remote" }); expect(job.description).not.toContain("<p>");
  });
  it("paginates Lever and stops on a short page", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply([{ id: "1", text: "A", descriptionPlain: "A".repeat(120), categories: {}, applyUrl: "https://x/1" }])).mockResolvedValueOnce(reply([])) as unknown as typeof fetch;
    const jobs = await fetchLever("acme", { pageSize: 1, maxPages: 5, fetcher }); expect(jobs).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retries a 429 and maps USAJOBS with required auth headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(reply({}, 429, { "retry-after": "0" })).mockResolvedValueOnce(reply({ SearchResult: { SearchResultCountAll: 1, SearchResultItems: [{ MatchedObjectDescriptor: { PositionID: "X", PositionTitle: "Analyst", OrganizationName: "Agency", PositionLocationDisplay: "Washington", PositionURI: "https://usajobs.gov/x", UserArea: { Details: { JobSummary: "Analyze secure systems and compliance requirements with documentation, stakeholder collaboration, testing, and operational responsibility for government services." } } } }] } }));
    const jobs = await fetchUsaJobs("security", { apiKey: "secret", userAgent: "user@example.com" }, { fetcher: fetchSpy as unknown as typeof fetch }); expect(jobs[0]).toMatchObject({ source: "usajobs", sourceId: "X" }); expect(fetchSpy).toHaveBeenCalledTimes(2); expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({ "Authorization-Key": "secret" });
  });
  it("parses forwarded alerts without authorizing site automation", () => {
    const [job] = parseForwardedJobAlert(`Subject: Platform Engineer\nCompany: Acme\nApply: https://example.com/job\n${"Build secure reliable systems with evidence and documentation. ".repeat(4)}`); expect(job).toMatchObject({ source: "email", company: "Acme" }); expect(job.permissions?.automatedIngestion).toBe(false);
  });
});
