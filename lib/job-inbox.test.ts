import { describe, expect, it } from "vitest";
import { addJobSnapshot, canonicalJobUrl, createJobSnapshot, duplicateKeys, parseJobImport } from "./job-inbox";

const description = "Build reliable distributed systems with TypeScript, PostgreSQL, observability, testing, incident response, mentoring, collaboration, and production ownership across engineering teams.";
const input = { company: "Acme", title: "Platform Engineer", location: "Remote", description, applicationUrl: "https://jobs.example.com/42?utm_source=x" };

describe("job inbox", () => {
  it("canonicalizes tracking URLs", () => expect(canonicalJobUrl(input.applicationUrl)).toBe("https://jobs.example.com/42"));
  it("creates immutable revisions with SHA-256 content hashes", async () => {
    const first = await createJobSnapshot(input, [], new Date("2026-01-01T00:00:00Z"));
    const second = await createJobSnapshot({ ...input, description: `${description} New revision.` }, [first], new Date("2026-01-02T00:00:00Z"));
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.revision).toBe(2);
    expect(second.previousSnapshotId).toBe(first.id);
    expect(first.description).toBe(description);
  });
  it("covers all four deduplication keys", async () => {
    const first = await createJobSnapshot({ ...input, source: "lever", sourceId: "abc" });
    const same = { ...first, id: crypto.randomUUID() };
    expect(duplicateKeys(first, same).sort()).toEqual(["canonicalUrl", "companyTitleLocation", "descriptionHash", "sourceId"].sort());
    expect(addJobSnapshot([first], same)).toMatchObject({ added: false, duplicateOf: first.id });
  });
  it("imports quoted CSV and JSON arrays", () => {
    const csv = `company,title,location,description,url\n"Acme, Inc",Engineer,Remote,"${description}",https://example.com/job`;
    expect(parseJobImport(csv, "csv")[0]).toMatchObject({ company: "Acme, Inc", source: "csv" });
    expect(parseJobImport(JSON.stringify([{ company: "Beta", jobTitle: "Lead", description }]), "json")[0]).toMatchObject({ company: "Beta", title: "Lead", source: "json" });
  });
});
