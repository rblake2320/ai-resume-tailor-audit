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
      resume: "x".repeat(200),
      jobDescription: "y".repeat(100),
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
