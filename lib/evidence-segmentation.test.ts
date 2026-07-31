import { describe, expect, it } from "vitest";
import { assertTailorResultEvidence, HonestyValidationError, type TailorResult } from "./schema.ts";

/**
 * Paired matrix for résumé record segmentation and degree qualifiers.
 *
 * Nine review rounds on this validator each fixed one direction and broke the
 * other: relaxing the comparison admitted cross-record fabrication, tightening
 * it withheld honest drafts. Every case here is a measured failure from one of
 * those rounds, and each rule appears in BOTH directions — an accept that must
 * not regress into a rejection, and a reject that must not regress into an
 * acceptance. A single-direction test is what let each round ship.
 */

const base = {
  match_score_before: 40, match_score_after: 70, score_rationale: "r",
  changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [],
  ats_checks: [], tailored_resume_markdown: "x", cover_letter_markdown: "y",
} as unknown as TailorResult;

function accepts(source: string, evidence: string, state: "proven" | "partially_supported" = "proven"): boolean {
  const result = {
    ...base,
    requirement_evidence: [{
      id: "r1", requirement: "req", category: "mandatory" as const, state,
      evidence: [evidence], tailoredText: [], recommendation: "",
    }],
  } as unknown as TailorResult;
  try {
    assertTailorResultEvidence(result, source);
    return true;
  } catch (error) {
    if (error instanceof HonestyValidationError) return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Wrapped lines must remain citable. A PDF résumé arrives hard-wrapped because
// unpdf emits a newline per visual line, so refusing a wrap refuses the user's
// own text.
// ---------------------------------------------------------------------------
describe("accepts citations that span a visual wrap", () => {
  it.each([
    ["lowercase continuation", "Built CI pipelines cutting\ndeploy time 40%", "Built CI pipelines cutting deploy time 40%"],
    ["CRLF", "Built CI pipelines cutting\r\ndeploy time 40%", "Built CI pipelines cutting deploy time 40%"],
    ["indented continuation", "Built CI pipelines cutting\n   deploy time 40%", "Built CI pipelines cutting deploy time 40%"],
    ["preposition then proper noun", "Led the platform migration to\nKubernetes across 12 teams", "platform migration to Kubernetes"],
    ["preposition, continuation ends in a year", "Led the platform migration to\nKubernetes across 12 teams in 2024", "migration to Kubernetes across 12 teams in 2024"],
    ["bullet, prose continuation", "• Managed a team of 12 engineers across payments\nIdentity and fraud domains", "engineers across payments Identity and fraud domains"],
    ["bullet, using + proper nouns", "• Migrated 200 services to containerized infrastructure using\nKubernetes and Terraform", "Migrated 200 services to containerized infrastructure using Kubernetes and Terraform"],
    ["bullet, including + title case list", "• Owned four production platforms including\nPayments, Identity and Fraud", "platforms including Payments, Identity and Fraud"],
    ["bullet, bare acronym continuation", "• Owned the platform for\nIBM", "Owned the platform for IBM"],
    ["bullet, continuation ends in a year", "• Migrated the payments platform to Kubernetes across three regions\nbetween 2021 and 2024", "across three regions between 2021 and 2024"],
    ["bullet, continuation starts with a year", "• Managed the payments platform\n2021 saw 40% growth in volume", "payments platform 2021 saw 40% growth"],
    ["three lines", "Owned the payments platform and\ndelivered three programs\nacross 12 regions", "Owned the payments platform and delivered three programs across 12 regions"],
    ["semicolon then lowercase", "Built CI pipelines;\nreduced deploy time 40%", "Built CI pipelines; reduced deploy time 40%"],
    ["colon then lowercase", "Delivered three programs:\nplatform, payments and identity", "Delivered three programs: platform, payments and identity"],
    ["abbreviation then lowercase", "Senior Engineer at Acme Inc.\nexpanded the platform to 12 regions", "Acme Inc. expanded the platform"],
    ["e.g. then lowercase", "Managed 12 engineers across 3 teams, e.g.\npayments and identity", "3 teams, e.g. payments and identity"],
    ["pct. then lowercase", "Reduced costs by 40 pct.\nacross all regions", "Reduced costs by 40 pct. across all regions"],
    ["U.S. then lowercase", "Authorized to work in the U.S.\nwithout sponsorship", "the U.S. without sponsorship"],
  ])("accepts a %s", (_name, source, evidence) => {
    expect(accepts(source, evidence)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Separate records must never fuse. A welded citation attributes one employer's
// achievement to another, which is fabrication the model reaches purely by
// choosing a longer span.
// ---------------------------------------------------------------------------
describe("refuses citations that fuse separate résumé records", () => {
  it.each([
    ["employer row on its own line", "• Built CI pipelines cutting deploy time 40%\nInitech Corp — Staff Engineer\n2015-2019", "deploy time 40% Initech Corp"],
    ["employer row with no dates anywhere", "• Built CI pipelines\nInitech Corp Staff Engineer", "Built CI pipelines Initech Corp"],
    ["company suffix row", "• Led the migration of the payments platform to Kubernetes\nUmbrella LLC", "to Kubernetes Umbrella LLC"],
    ["date row", "• Built CI pipelines cutting deploy time 40%\n2015-2019", "deploy time 40% 2015-2019"],
    ["all-caps heading", "• Built CI pipelines\nEDUCATION\nMIT", "Built CI pipelines EDUCATION"],
    ["title-case heading", "• Built CI pipelines\nEducation\nMIT", "Built CI pipelines Education"],
    ["two-word title-case heading", "• Supported the billing platform\nTechnical Skills\nPython, Kubernetes, AWS", "billing platform Technical Skills"],
    ["ampersand heading", "• Supported the billing platform\nCertifications & Awards\nAWS SA", "billing platform Certifications & Awards"],
    ["institution row", "• Built CI pipelines\nMassachusetts Institute of Technology", "Built CI pipelines Massachusetts Institute of Technology"],
    ["bare skills list", "• Built CI pipelines\nKubernetes, Terraform, AWS", "Built CI pipelines Kubernetes, Terraform"],
    ["sentence end then new sentence", "Led the Kubernetes migration.\nManaged a team of 12 engineers.", "Kubernetes migration. Managed a team"],
    ["two employer rows", "Acme Corp\nInitech Corp", "Acme Corp Initech Corp"],
    ["heading then body", "EXPERIENCE\nSenior Engineer at Acme", "EXPERIENCE Senior Engineer at Acme"],
    ["blank line", "Acme Corp\n\nInitech Corp", "Acme Corp Initech Corp"],
    ["horizontal rule", "Senior Engineer at Acme, 2019 - 2024\n---\nCertifications: AWS SA", "2019 - 2024 Certifications"],
    ["em-dash separator", "Acme Corp\n—\nInitech Corp", "Acme Corp - Initech Corp"],
    ["form feed page break", "Acme Corp\fInitech Corp", "Acme Corp Initech Corp"],
    ["line separator", "Acme Corp Initech Corp", "Acme Corp Initech Corp"],
    ["bullet to bullet", "• Python, SQL\n• Kubernetes (evaluated only)", "Python, SQL Kubernetes (evaluated only)"],
    // Corrected from my own earlier round. I had required these to ACCEPT
    // because they passed on the previous head — but that head joined every
    // line after a bullet unconditionally, and main accepts everything, so
    // neither was evidence of correctness. A capitalised past-tense verb after
    // a complete line opens a new achievement whose marker PDF extraction
    // dropped, so citing across it welds two achievements.
    ["achievement after an achievement", "• Built CI pipelines cutting deploy time 40%\nReduced infrastructure costs across all regions", "deploy time 40% Reduced infrastructure costs"],
    ["achievement after an employer line", "Senior Engineer at Acme Inc.\nExpanded the platform to 12 regions", "Acme Inc. Expanded the platform"],
    ["achievement after a bullet", "• Owned the payments platform\nDelivered three programs on time", "payments platform Delivered three programs"],
    ["achievement after a dated bullet", "- Shipped 12 releases in 2024\nMentored four engineers", "12 releases in 2024 Mentored four engineers"],
  ])("refuses a splice across a %s", (_name, source, evidence) => {
    expect(accepts(source, evidence)).toBe(false);
  });

  it("refuses an Acme achievement attributed to the next employer, on a realistic PDF shape", () => {
    // unpdf emits one newline per visual line and joins pages with a newline, so
    // a PDF résumé has no blank lines, no form feeds, no Markdown headings and
    // no rules — bullet markers and record-shaped rows are the only boundaries.
    const pdf = [
      "Acme Corp — Senior Engineer",
      "2019-2024",
      "• Built CI pipelines cutting deploy time 40%",
      "• Led the migration of 200 services to containerized infrastructure",
      "Initech Corp — Staff Engineer",
      "2015-2019",
      "• Evaluated Kubernetes but never deployed it to production",
    ].join("\n");
    expect(accepts(pdf, "Built CI pipelines cutting deploy time 40%")).toBe(true);
    expect(accepts(pdf, "containerized infrastructure Initech Corp — Staff Engineer")).toBe(false);
    expect(accepts(pdf, "deploy time 40% Initech Corp")).toBe(false);
    expect(accepts(pdf, "to production EDUCATION")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Degree qualifiers. "Limited experience with X" is the canonical honest
// disclaimer; citing a shortened span must not launder it into proof.
// ---------------------------------------------------------------------------
describe("degree qualifiers survive a shortened citation", () => {
  it.each([
    ["relational gap, span shortened to the skill", "Limited experience with Kubernetes.", "Kubernetes"],
    ["minimal, relational gap", "Minimal experience with Kubernetes.", "Kubernetes"],
    ["familiarity with", "Limited familiarity with Terraform.", "Terraform"],
    ["knowledge of", "Limited knowledge of Kubernetes.", "Kubernetes"],
    ["proficiency with", "Limited proficiency with Kubernetes.", "Kubernetes"],
    ["skills at", "Limited skills at Kubernetes administration.", "Kubernetes administration"],
    ["experience from", "Limited experience from Kubernetes projects.", "Kubernetes projects"],
    ["inside a bullet", "• Limited experience with Kubernetes; primarily Docker Compose", "Kubernetes"],
    ["adjacent qualifier, full span", "Minimal Kubernetes experience.", "Kubernetes experience"],
    ["adjacent qualifier, span shortened", "Minimal Kubernetes experience.", "Kubernetes"],
    ["intervening adjective", "Limited hands-on Kubernetes experience.", "Kubernetes experience"],
    ["expertise", "Limited Kubernetes expertise.", "Kubernetes expertise"],
  ])("refuses proof from a %s", (_name, source, evidence) => {
    expect(accepts(source, evidence)).toBe(false);
  });

  it.each([
    ["Limited experience with Kubernetes.", "Kubernetes"],
    ["Minimal Kubernetes experience.", "Kubernetes"],
  ])("still allows %s as partially supported", (source, evidence) => {
    expect(accepts(source, evidence, "partially_supported")).toBe(true);
  });

  it.each([
    ["incorporated employer", "Acme Limited built CI pipelines cutting deploy time 40%", "built CI pipelines cutting deploy time 40%"],
    ["incorporated employer with a nearby skills line", "Acme Limited — built CI pipelines cutting deploy time 40%. Skills: Python, SQL", "built CI pipelines cutting deploy time 40%"],
    ["incorporated employer with a nearby background line", "Acme Limited built CI pipelines. Background in payments and identity.", "built CI pipelines"],
    ["employer then years of experience", "Senior Engineer at Contoso Limited with 9 years of experience shipping payments", "9 years of experience shipping payments"],
    ["employer then duration", "Worked at Smith Limited for six years building payment skills", "building payment"],
    ["employer with a date and a noun in clause", "Employed at Acme Limited from 2019; built CI pipelines with Terraform experience", "built CI pipelines with Terraform experience"],
    ["minimal oversight", "Operated with minimal oversight across 12 regions. Skills: Python.", "oversight across 12 regions"],
    ["limited partnership", "Advised a limited partnership on cloud spend. Expertise: cloud cost.", "partnership on cloud spend"],
  ])("accepts honest evidence beside a %s", (_name, source, evidence) => {
    expect(accepts(source, evidence)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Negation must stay clause-scoped: an honest claim beside an unrelated denial
// remains citable, and a denial is never citable as proof.
// ---------------------------------------------------------------------------
describe("negation stays scoped to its own clause", () => {
  it.each([
    ["Built CI pipelines cutting deploy time 40%. Did not use Kubernetes.", "Built CI pipelines cutting deploy time 40%"],
    ["No formal management experience. Built CI pipelines.", "Built CI pipelines"],
    ["Not only built CI pipelines but also owned releases.", "built CI pipelines"],
    ["Never missed a deadline while owning the release process.", "owning the release process"],
    ["No Kubernetes yet built CI pipelines", "built CI pipelines"],
    ["No production experience but familiar with Rust.", "familiar with Rust"],
    ["Delivered no less than 12 releases in 2024", "12 releases in 2024"],
    ["Migrated with zero downtime and shipped Postgres migrations", "shipped Postgres migrations"],
  ])("accepts honest evidence in %s", (source, evidence) => {
    expect(accepts(source, evidence)).toBe(true);
  });

  it.each([
    ["Familiar with Rust but no production experience.", "production experience"],
    ["Not proficient in Kubernetes.", "proficient in Kubernetes"],
    ["Not yet proficient in Kubernetes.", "proficient in Kubernetes"],
    ["Never yet shipped Kubernetes to production.", "shipped Kubernetes to production"],
    ["No experience with Terraform.", "experience with Terraform"],
    ["Not only lacking Kubernetes experience, but also new to Go.", "Kubernetes experience"],
  ])("refuses proof from a denial in %s", (source, evidence) => {
    expect(accepts(source, evidence)).toBe(false);
  });
});
