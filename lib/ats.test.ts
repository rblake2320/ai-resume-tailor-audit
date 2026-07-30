import { describe, expect, it } from "vitest";
import { extractKeywords, scanResume } from "./ats";

const JD = `
Senior Backend Engineer — Payments

We are looking for a Senior Backend Engineer to join our payments team.
You will design distributed systems in Go and Python, own our Kubernetes
deployments, and build event pipelines on Kafka. Experience with PostgreSQL,
Terraform, and CI/CD is required. Experience with machine learning is a plus.
Kubernetes experience is essential. Kafka and Kubernetes power our platform.
Machine learning models drive our fraud detection. Machine learning at scale.
`;

const RESUME = `
Jane Doe — Backend Engineer
Built distributed systems in Go serving 2M requests/day. Managed Kubernetes
clusters and wrote Terraform modules. Designed Kafka event pipelines and
PostgreSQL schemas.
`;

describe("extractKeywords", () => {
  it("finds significant repeated terms", () => {
    const kws = extractKeywords(JD).map((k) => k.keyword);
    expect(kws).toContain("kubernetes");
    expect(kws).toContain("kafka");
    expect(kws).toContain("machine learning");
  });

  it("prefers bigrams over their component words", () => {
    const kws = extractKeywords(JD).map((k) => k.keyword);
    expect(kws).toContain("machine learning");
    expect(kws).not.toContain("machine");
  });

  it("filters stopwords and HR boilerplate", () => {
    const kws = extractKeywords(JD).map((k) => k.keyword);
    expect(kws).not.toContain("the");
    expect(kws).not.toContain("experience");
    expect(kws).not.toContain("required");
  });

  it("respects the limit", () => {
    expect(extractKeywords(JD, 5).length).toBeLessThanOrEqual(5);
  });

  it("returns empty for empty input", () => {
    expect(extractKeywords("")).toEqual([]);
  });
});

describe("scanResume", () => {
  it("marks present and missing keywords correctly", () => {
    const scan = scanResume(RESUME, JD);
    const byKeyword = Object.fromEntries(scan.keywords.map((k) => [k.keyword, k.inResume]));
    expect(byKeyword["kubernetes"]).toBe(true);
    expect(byKeyword["kafka"]).toBe(true);
    expect(byKeyword["machine learning"]).toBe(false);
  });

  it("computes coverage as a 0-100 integer", () => {
    const scan = scanResume(RESUME, JD);
    expect(scan.coverage).toBeGreaterThan(0);
    expect(scan.coverage).toBeLessThanOrEqual(100);
    expect(Number.isInteger(scan.coverage)).toBe(true);
    expect(scan.coverage).toBe(Math.round((scan.matched / scan.total) * 100));
  });

  it("is case-insensitive", () => {
    const scan = scanResume(RESUME.toUpperCase(), JD);
    expect(scan.keywords.find((k) => k.keyword === "kubernetes")?.inResume).toBe(true);
  });

  it("handles empty inputs without crashing", () => {
    const scan = scanResume("", "");
    expect(scan.total).toBe(0);
    expect(scan.coverage).toBe(0);
  });
});
