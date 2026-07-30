import { z } from "zod";

export const TailorResultSchema = z.strictObject({
  match_score_before: z
    .int()
    .describe("How well the ORIGINAL resume matches the job, 0-100"),
  match_score_after: z
    .int()
    .describe("How well the TAILORED resume matches the job, 0-100"),
  score_rationale: z
    .string()
    .describe(
      "One short paragraph explaining exactly how the scores were computed: which requirements matched, which were missing, and what the tailoring changed",
    ),
  changes: z
    .array(
      z.strictObject({
        kind: z
          .enum(["reworded", "reordered", "removed", "emphasized"])
          .describe(
            "reworded = phrasing changed; reordered = moved for relevance; removed = cut as irrelevant; emphasized = promoted or expanded using ONLY facts already in the resume",
          ),
        detail: z
          .string()
          .describe("What changed and why, phrased as 'X → Y because Z'"),
      }),
    )
    .describe("Every substantive change made to the resume — the full transparent diff, one entry per change"),
  keywords: z.strictObject({
    matched: z
      .array(z.string())
      .describe("Job keywords already present in the original resume"),
    added: z
      .array(z.string())
      .describe(
        "Job keywords incorporated during tailoring, ONLY where the resume gave honest evidence for them",
      ),
    not_added: z
      .array(
        z.strictObject({
          keyword: z.string(),
          reason: z
            .string()
            .describe("Why this was NOT added, e.g. no evidence in resume"),
        }),
      )
      .describe(
        "Job keywords deliberately NOT added because the resume shows no evidence — the honesty guarantee",
      ),
  }),
  gap_analysis: z
    .array(
      z.strictObject({
        gap: z.string().describe("A real gap between the resume and the job"),
        advice: z
          .string()
          .describe(
            "Concrete, actionable advice: what to learn, build, or emphasize before applying or in the interview",
          ),
      }),
    )
    .describe("Honest gaps the candidate should know about"),
  ats_checks: z
    .array(
      z.strictObject({
        check: z.string().describe("Name of the ATS formatting/content check"),
        status: z.enum(["pass", "warn"]),
        note: z.string().describe("Short explanation and fix if warn"),
      }),
    )
    .describe(
      "ATS-parseability checks performed on the tailored resume: standard section headers, no tables/columns, contact info in body, dates parseable, keywords in context",
    ),
  tailored_resume_markdown: z
    .string()
    .describe(
      "The complete tailored resume in clean Markdown: # Name, contact line, ## Summary, ## Experience, ## Education, ## Skills. ATS-safe single column.",
    ),
  cover_letter_markdown: z
    .string()
    .describe(
      "A tailored, specific cover letter in Markdown, 250-350 words, referencing real items from the resume and the job posting. No placeholders except [Hiring Manager] if no name is known.",
    ),
});

export type TailorResult = z.infer<typeof TailorResultSchema>;

/**
 * JSON schema for the Claude structured-output format:
 * additionalProperties:false everywhere, and no numeric constraints
 * (min/max are unsupported by structured outputs — Zod emits safe-integer
 * bounds for int(), so strip them).
 */
export function tailorResultJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(TailorResultSchema) as Record<string, unknown>;
  const strip = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    delete n.minimum;
    delete n.maximum;
    delete n.exclusiveMinimum;
    delete n.exclusiveMaximum;
    for (const v of Object.values(n)) strip(v);
  };
  strip(schema);
  return schema;
}

export const TailorRequestSchema = z.object({
  resume: z.string().min(200, "Resume text looks too short — paste the full resume (at least 200 characters)."),
  jobDescription: z.string().min(100, "Job description looks too short — paste the full posting (at least 100 characters)."),
  jobTitle: z.string().max(200).optional().default(""),
  company: z.string().max(200).optional().default(""),
  emphasis: z.enum(["balanced", "technical", "leadership"]).optional().default("balanced"),
});

export type TailorRequest = z.infer<typeof TailorRequestSchema>;
