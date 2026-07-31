import { describe, expect, it } from "vitest";
import {
  TailorRequestSchema,
  TailorResultSchema,
  tailorResultJsonSchema,
} from "./schema";

const VALID_RESULT = {
  match_score_before: 55,
  match_score_after: 78,
  score_rationale: "Matched 7 of 10 stated requirements…",
  changes: [{ kind: "reworded", detail: "Summary → targeted payments-platform pitch" }],
  keywords: {
    matched: ["kubernetes"],
    added: ["ci/cd"],
    not_added: [{ keyword: "rust", reason: "no evidence in resume" }],
  },
  gap_analysis: [{ gap: "No Rust experience", advice: "Ship a small Rust CLI project" }],
  requirement_evidence: [{
    id: "rust",
    requirement: "Rust",
    category: "mandatory",
    state: "unsupported",
    evidence: [] as string[],
    tailoredText: [] as string[],
    recommendation: "Build and publish a small Rust project.",
  }],
  ats_checks: [{ check: "Single column", status: "pass", note: "OK" }],
  tailored_resume_markdown: "# Jane Doe",
  cover_letter_markdown: "Dear [Hiring Manager]…",
};

describe("TailorResultSchema", () => {
  it("accepts a valid result", () => {
    expect(() => TailorResultSchema.parse(VALID_RESULT)).not.toThrow();
  });

  it("rejects unknown keys (strict everywhere)", () => {
    expect(() => TailorResultSchema.parse({ ...VALID_RESULT, extra: 1 })).toThrow();
  });

  it("rejects bad change kinds", () => {
    expect(() =>
      TailorResultSchema.parse({
        ...VALID_RESULT,
        changes: [{ kind: "fabricated", detail: "x" }],
      }),
    ).toThrow();
  });

  it("rejects unsupported requirements that claim evidence or tailored text", () => {
    const dishonest = structuredClone(VALID_RESULT);
    dishonest.requirement_evidence[0] = {
      ...dishonest.requirement_evidence[0],
      evidence: ["Invented Rust experience"],
    };
    expect(() => TailorResultSchema.parse(dishonest)).toThrow(/Unsupported requirements/);
  });
});

describe("tailorResultJsonSchema", () => {
  it("emits additionalProperties:false on every object (structured-output requirement)", () => {
    const schema = tailorResultJsonSchema();
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") objects.push(n);
      for (const v of Object.values(n)) walk(v);
    };
    walk(schema);
    expect(objects.length).toBeGreaterThan(3);
    for (const obj of objects) expect(obj.additionalProperties).toBe(false);
  });

  it("does not emit unsupported numeric constraints", () => {
    const json = JSON.stringify(tailorResultJsonSchema());
    expect(json).not.toContain('"minimum"');
    expect(json).not.toContain('"maximum"');
  });
});

describe("TailorRequestSchema", () => {
  it("applies defaults", () => {
    const parsed = TailorRequestSchema.parse({
      resume: "Jordan Blake, Senior Software Engineer with eight years building scalable web platforms in Python, TypeScript, and Go. Led a team of six engineers migrating a monolith to microservices on AWS, cutting latency and improving reliability for payment services. Built CI pipelines and mentored junior developers. B.S. Computer Science.",
      jobDescription: "We are hiring a Staff Backend Engineer to lead our payments platform, design distributed systems, own reliability and observability, mentor engineers, and drive architecture for high throughput services using Python, Go, AWS, Kafka, and Postgres.",
    });
    expect(parsed.emphasis).toBe("balanced");
    expect(parsed.jobTitle).toBe("");
  });

  it("rejects too-short inputs with helpful messages", () => {
    const res = TailorRequestSchema.safeParse({ resume: "short", jobDescription: "short" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.message.includes("Resume"))).toBe(true);
    }
  });
});

import { describe as d3, it as i3, expect as e3 } from "vitest";
d3("TailorRequestSchema — content-quality gate", () => {
  const jd = "We are hiring a Staff Backend Engineer to design distributed systems, own reliability, mentor engineers, and drive architecture for high throughput payment services using Python, Go, AWS, Kafka, and Postgres across our platform.";
  for (const [label, resume] of [
    ["repeated char", "x".repeat(300)],
    ["repeated token", "spam ".repeat(120)],
    ["emoji only", "🎉".repeat(200)],
    ["whitespace", "   \n\t ".repeat(80)],
    ["zero-width", "​".repeat(400)],
    ["html repeat", "<script>x</script>".repeat(40)],
  ] as const) {
    i3(`rejects junk resume: ${label}`, () => {
      const r = TailorRequestSchema.safeParse({ resume, jobDescription: jd });
      e3(r.success).toBe(false);
    });
  }
});
