import { z } from "zod";
import { mdToAtsText } from "./markdown.ts";
import { affirmativelyPresent } from "./ats.ts";

export const EvidenceStateSchema = z.enum([
  "proven", "partially_supported", "unsupported", "needs_clarification", "intentionally_omitted",
]);

export const RequirementEvidenceSchema = z.strictObject({
  id: z.string().min(1).max(100),
  requirement: z.string().min(1),
  category: z.enum(["mandatory", "preferred", "responsibility", "logistics"]),
  state: EvidenceStateSchema,
  evidence: z.array(z.string().max(2_000)).max(10).describe("Exact facts from the original resume supporting this requirement; empty when unsupported"),
  tailoredText: z.array(z.string().max(2_000)).max(20).describe("Exact resulting resume or cover-letter text tied to this requirement; empty when unsupported"),
  recommendation: z.string().describe("Honest next step, clarification, adjacent skill, portfolio task, training, or omission rationale"),
}).superRefine((item, context) => {
  if (item.state === "unsupported" && (item.evidence.length > 0 || item.tailoredText.length > 0)) {
    context.addIssue({ code: "custom", message: "Unsupported requirements cannot claim evidence or tailored text." });
  }
  if ((item.state === "proven" || item.state === "partially_supported") && item.evidence.length === 0) {
    context.addIssue({ code: "custom", message: "Supported requirements must cite résumé evidence." });
  }
});

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
  requirement_evidence: z
    .array(RequirementEvidenceSchema).max(100)
    .describe("Auditable mapping of each material job requirement to source résumé evidence and resulting tailored text"),
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

export class HonestyValidationError extends Error {
  public readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`Generated content failed evidence validation: ${violations.join(" ")}`);
    this.name = "HonestyValidationError";
    this.violations = violations;
  }
}

export type HonestyViolationSummary = {
  sourceCitationMismatch: number;
  outputReferenceMismatch: number;
  addedKeywordMismatch: number;
};

/** Content-free operational diagnostics: counts rule classes without logging résumé or job text. */
export function summarizeHonestyViolations(violations: readonly string[]): HonestyViolationSummary {
  return {
    sourceCitationMismatch: violations.filter((item) => item.includes("cites evidence absent")).length,
    outputReferenceMismatch: violations.filter((item) => item.includes("references tailored text absent")).length,
    addedKeywordMismatch: violations.filter((item) => item.startsWith("Added keyword ")).length,
  };
}

const comparableText = (value: string) => value
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .normalize("NFKC")
  .toLocaleLowerCase("en-US")
  .replace(/[\u2010-\u2015\u2212]/gu, "-")
  .replace(/[\u2018\u2019]/gu, "'")
  .replace(/[\u201c\u201d]/gu, '"')
  .replace(/\s+/gu, " ")
  .trim();

// Résumés and evidence are plain text. Generated documents are Markdown.
// Keeping those paths separate prevents Markdown-shaped source text (for
// example a footnote beginning with "*") from being rewritten asymmetrically.
const comparableSource = (value: string) => comparableText(value);
const comparableOutput = (value: string) => comparableText(mdToAtsText(value));

const qualifiedRatherThanProven = (evidence: string): boolean => {
  const text = comparableSource(evidence);
  return /^(?:no|not|never|zero|without|lacks?|lacking|unfamiliar(?: with)?|only evaluated|beginner in|exposure to|aspiring to(?: be)?|hope to become|failed to become|seeking to learn)\b/u.test(text)
    || /\b(?:minimal|limited)\b.{0,60}\b(?:experience|proficiency|knowledge|familiarity|exposure)\b/u.test(text)
    || /\bevaluated\b.{0,40}\b(?:but\s+)?did\s+not\s+deploy\b/u.test(text);
};

const CONTINUATION_END = /\b(?:a|an|and|as|at|by|for|from|in|of|on|or|the|to|with|across|cutting)$/iu;

/**
 * Reconstruct likely logical lines from PDF visual-line output without
 * joining separate bullets, headings, pages, or short record-like rows.
 * This is deliberately conservative: a long sentence or an explicit
 * continuation may cross a visual wrap; structural boundaries never do.
 */
const sourceEvidenceSegments = (source: string): string[] => {
  const segments: string[] = [];
  let current = "";
  let bullet = false;
  const flush = () => {
    const normalized = comparableSource(current);
    if (normalized) segments.push(normalized);
    current = "";
    bullet = false;
  };

  for (const raw of source.replace(/[\v\f\u2028\u2029]/gu, "\n\n").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || /^(?:[-*_]{3,}|[\u2010-\u2015\u2212])$/u.test(line) || /^#{1,6}\s/u.test(line)) {
      flush();
      continue;
    }
    const bulletMatch = line.match(/^[-*+\u2022]\s+(.+)$/u);
    if (bulletMatch) {
      flush();
      // Preserve the literal source line as an alternate exact span for
      // résumés where a leading marker is meaningful text, while building a
      // marker-free logical record for ordinary model citations and wraps.
      segments.push(comparableSource(line));
      current = bulletMatch[1];
      bullet = true;
      continue;
    }
    if (!current) {
      current = line;
      continue;
    }
    const currentWords = current.trim().split(/\s+/u).length;
    const isContinuation = bullet
      || currentWords >= 4
      || CONTINUATION_END.test(current)
      || /^[\p{Ll}\p{N},.;:)]/u.test(line);
    if (isContinuation) current += ` ${line}`;
    else {
      flush();
      current = line;
    }
  }
  flush();
  return segments;
};

/** Deterministic post-generation boundary for structured evidence references. */
export function assertTailorResultEvidence(result: TailorResult, originalResume: string): void {
  const sourceLines = sourceEvidenceSegments(originalResume);
  const output = comparableOutput(`${result.tailored_resume_markdown}\n${result.cover_letter_markdown}`);
  const violations: string[] = [];
  const supportCache = new Map<string, boolean>();
  for (const requirement of result.requirement_evidence) {
    for (const evidence of requirement.evidence) {
      const cited = comparableSource(evidence);
      const cacheKey = `${requirement.state === "proven" ? "1" : "0"}\u0000${cited}`;
      let supported = supportCache.get(cacheKey);
      if (supported === undefined) {
        supported = sourceLines.some((line) => line.includes(cited)
          && affirmativelyPresent(line, cited, requirement.state === "proven"));
        supportCache.set(cacheKey, supported);
      }
      const overclaimed = requirement.state === "proven" && qualifiedRatherThanProven(evidence);
      if (!supported || overclaimed) violations.push(`Requirement ${requirement.id} cites evidence absent from the original résumé.`);
    }
    for (const text of requirement.tailoredText) {
      if (!output.includes(comparableSource(text))) violations.push(`Requirement ${requirement.id} references tailored text absent from the generated documents.`);
    }
  }
  for (const keyword of result.keywords.added) {
    if (!output.includes(comparableSource(keyword))) violations.push(`Added keyword "${keyword}" is absent from the generated documents.`);
  }
  if (violations.length) throw new HonestyValidationError([...new Set(violations)]);
}

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

// ---- Content-quality gate ------------------------------------------------
// Length alone let junk through: 100 "x"s, emoji-only, whitespace/zero-width,
// and repeated tokens all passed. These stats require actual, varied natural
// language before we spend an AI call.
const ZERO_WIDTH = /[\​-\‍\﻿\⁠\­]/g;

export function contentStats(text: string): { words: number; unique: number; letters: number } {
  const cleaned = (text ?? "").normalize("NFKC").replace(ZERO_WIDTH, "");
  const words = cleaned.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'+.#/-]*/gu) ?? [];
  const letters = (cleaned.match(/\p{L}/gu) ?? []).length;
  return { words: words.length, unique: new Set(words).size, letters };
}

/** True when the text reads like real, varied language (not filler/junk). */
export function looksLikeContent(
  text: string,
  min: { words: number; unique: number; letters: number },
): boolean {
  const s = contentStats(text);
  return s.words >= min.words && s.unique >= min.unique && s.letters >= min.letters;
}

export const RESUME_CONTENT_MIN = { words: 40, unique: 25, letters: 120 };
export const JD_CONTENT_MIN = { words: 20, unique: 15, letters: 60 };
export const RESUME_TEXT_MAX = 100_000;
export const JOB_DESCRIPTION_MAX = 100_000;

export const TailorRequestSchema = z.object({
  resume: z
    .string()
    .min(200, "Resume text looks too short — paste the full resume (at least 200 characters).")
    .max(RESUME_TEXT_MAX, `Resume text must be at most ${RESUME_TEXT_MAX.toLocaleString("en-US")} characters.`)
    .refine((t) => looksLikeContent(t, RESUME_CONTENT_MIN),
      "That doesn't look like real resume text — paste your actual resume (varied, natural language)."),
  jobDescription: z
    .string()
    .min(100, "Job description looks too short — paste the full posting (at least 100 characters).")
    .max(JOB_DESCRIPTION_MAX, `Job description must be at most ${JOB_DESCRIPTION_MAX.toLocaleString("en-US")} characters.`)
    .refine((t) => looksLikeContent(t, JD_CONTENT_MIN),
      "That doesn't look like a real job posting — paste the actual description (varied, natural language)."),
  jobTitle: z.string().max(200).optional().default(""),
  company: z.string().max(200).optional().default(""),
  emphasis: z.enum(["balanced", "technical", "leadership"]).optional().default("balanced"),
});

export type TailorRequest = z.infer<typeof TailorRequestSchema>;

// ---- Job Search OS: normalized posting snapshots -----------------------
export const JobSourceSchema = z.enum([
  "manual", "url", "csv", "json", "greenhouse", "lever", "usajobs", "email", "other",
]);
export const RemoteStatusSchema = z.enum(["remote", "hybrid", "onsite", "unspecified"]);
export const SourcePermissionSchema = z.strictObject({
  automatedIngestion: z.boolean(),
  guidedHandoff: z.boolean(),
  directSubmission: z.boolean(),
  requiresEmployerAuthorization: z.boolean(),
  termsUrl: z.string().url().or(z.literal("")),
  note: z.string().max(1000),
});
export const CompensationSchema = z.strictObject({
  currency: z.string().min(3).max(3).default("USD"),
  minimum: z.number().finite().nonnegative().nullable().default(null),
  maximum: z.number().finite().nonnegative().nullable().default(null),
  interval: z.enum(["hour", "day", "week", "month", "year", "other"]).default("year"),
  description: z.string().max(500).default(""),
}).refine((value) => value.maximum === null || value.minimum === null || value.maximum >= value.minimum,
  "Compensation maximum must be greater than or equal to minimum.");

export const JobPostingSnapshotSchema = z.strictObject({
  id: z.string().min(1),
  source: JobSourceSchema,
  sourceId: z.string().max(500).default(""),
  permissions: SourcePermissionSchema.default({
    automatedIngestion: false, guidedHandoff: true, directSubmission: false,
    requiresEmployerAuthorization: false, termsUrl: "", note: "User-provided posting; no automated source access assumed.",
  }),
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  location: z.string().max(300).default(""),
  remoteStatus: RemoteStatusSchema.default("unspecified"),
  compensation: CompensationSchema.nullable().default(null),
  description: z.string().min(100),
  requiredQualifications: z.array(z.string().min(1).max(1000)).default([]),
  preferredQualifications: z.array(z.string().min(1).max(1000)).default([]),
  applicationUrl: z.string().url().or(z.literal("")),
  postedAt: z.string().datetime().nullable().default(null),
  closesAt: z.string().datetime().nullable().default(null),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  previousSnapshotId: z.string().nullable().default(null),
});

export type JobSource = z.infer<typeof JobSourceSchema>;
export type RemoteStatus = z.infer<typeof RemoteStatusSchema>;
export type JobPostingSnapshot = z.infer<typeof JobPostingSnapshotSchema>;
export type SourcePermission = z.infer<typeof SourcePermissionSchema>;
