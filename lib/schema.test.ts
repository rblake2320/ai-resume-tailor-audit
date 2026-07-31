import { describe, expect, it } from "vitest";
import {
  assertTailorResultEvidence,
  summarizeHonestyViolations,
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

describe("deterministic evidence boundary", () => {
  const resultForEvidence = (evidence: string, state: "proven" | "partially_supported" = "proven") => TailorResultSchema.parse({
    ...VALID_RESULT,
    keywords: { ...VALID_RESULT.keywords, added: [] },
    requirement_evidence: [{ id: "evidence", requirement: "Evidence", category: "mandatory", state,
      evidence: [evidence], tailoredText: ["Supported claim"], recommendation: "" }],
    tailored_resume_markdown: "# Jane Doe\nSupported claim",
  });
  it("accepts source-backed evidence and output references", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: ["CI/CD"] },
      requirement_evidence: [{ id: "delivery", requirement: "Delivery", category: "mandatory", state: "proven",
        evidence: ["Built CI pipelines"], tailoredText: ["Built CI pipelines"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nBuilt CI pipelines and improved CI/CD delivery.",
    });
    expect(() => assertTailorResultEvidence(result, "Engineer. Built CI pipelines for releases.")).not.toThrow();
  });
  it("compares visible text across Markdown, XML entities, and typographic punctuation", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: ["CI/CD"] },
      requirement_evidence: [{ id: "delivery", requirement: "Delivery", category: "mandatory", state: "proven",
        evidence: ["AT&amp;T platform work, 2021 - Present"], tailoredText: ["AT&T platform work, 2021 - Present with CI/CD"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\n**AT&T platform work, 2021 – Present** with **CI/CD**.",
    });
    expect(() => assertTailorResultEvidence(result, "AT&T platform work, 2021 – Present")).not.toThrow();
  });
  it("still rejects paraphrased or stitched evidence after presentation normalization", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      requirement_evidence: [{ id: "delivery", requirement: "Delivery", category: "mandatory", state: "proven",
        evidence: ["Built CI pipelines and mentored four engineers"], tailoredText: ["Built CI pipelines"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nBuilt CI pipelines.",
    });
    expect(() => assertTailorResultEvidence(result, "Built CI pipelines. Mentored four engineers.")).toThrow(/failed evidence validation/);
  });
  it("rejects a positive citation found only inside a negated disclaimer", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      requirement_evidence: [{ id: "k8s", requirement: "Kubernetes", category: "mandatory", state: "proven",
        evidence: ["proficient in Kubernetes"], tailoredText: ["proficient in Kubernetes"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nproficient in Kubernetes",
    });
    expect(() => assertTailorResultEvidence(result, "Not proficient in Kubernetes.")).toThrow(/failed evidence validation/);
  });
  it("rejects a citation found only inside a no-experience disclaimer", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: [] },
      requirement_evidence: [{ id: "production", requirement: "Production", category: "mandatory", state: "proven",
        evidence: ["production experience"], tailoredText: ["production experience"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nproduction experience",
    });
    expect(() => assertTailorResultEvidence(result, "Familiar with Rust but no production experience.")).toThrow(/failed evidence validation/);
  });
  it("keeps an affirmative citation valid when another clause is negated", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: [] },
      requirement_evidence: [{ id: "delivery", requirement: "Delivery", category: "mandatory", state: "proven",
        evidence: ["Built CI pipelines"], tailoredText: ["Built CI pipelines"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nBuilt CI pipelines",
    });
    expect(() => assertTailorResultEvidence(result, "Built CI pipelines. Did not use Kubernetes.")).not.toThrow();
  });
  it("does not treat Markdown-shaped plain source text asymmetrically", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: [] },
      requirement_evidence: [{ id: "footnote", requirement: "Operations", category: "mandatory", state: "proven",
        evidence: ["* operated the deployment process"], tailoredText: ["operated the deployment process"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nOperated the deployment process.",
    });
    expect(() => assertTailorResultEvidence(result, "Experience\n* operated the deployment process")).not.toThrow();
  });
  it.each([
    ["section separator", "Senior Engineer at Acme, 2019 - 2024\n---\nCertifications: AWS Solutions Architect (2024)", "Senior Engineer at Acme, 2019 - 2024 Certifications: AWS Solutions Architect (2024)"],
    ["different bullet markers", "* Python\n- Kubernetes (evaluated only)", "Python • Kubernetes (evaluated only)"],
    ["heading boundary", "## SKILLS\nPython, SQL\n\n## CERTIFICATIONS\nAWS Solutions Architect", "Python, SQL CERTIFICATIONS AWS Solutions Architect"],
  ])("does not splice evidence across a %s", (_label, resume, stitchedEvidence) => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: [] },
      requirement_evidence: [{ id: "boundary", requirement: "Boundary", category: "mandatory", state: "proven",
        evidence: [stitchedEvidence], tailoredText: ["Supported claim"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nSupported claim",
    });
    expect(() => assertTailorResultEvidence(result, resume)).toThrow(/failed evidence validation/);
  });
  it.each([
    ["blank line", "Acme Corp\n\nInitech Corp", "Acme Corp Initech Corp"],
    ["single newline", "Acme Corp\nInitech Corp", "Acme Corp Initech Corp"],
    ["em-dash separator", "Acme Corp\n—\nInitech Corp", "Acme Corp - Initech Corp"],
  ])("rejects a citation fused across a %s", (_label, resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).toThrow(/failed evidence validation/);
  });
  it.each([
    ["LF", "Built CI pipelines cutting\ndeploy time 40%", "Built CI pipelines cutting deploy time 40%"],
    ["CRLF", "Built CI pipelines cutting\r\ndeploy time 40%", "Built CI pipelines cutting deploy time 40%"],
    ["indented PDF continuation", "- Built distributed systems across AWS and\n  Kubernetes, reducing latency 40%", "Built distributed systems across AWS and Kubernetes, reducing latency 40%"],
    ["preposition wrap", "Led the platform migration to\nKubernetes across 12 teams", "platform migration to Kubernetes"],
    ["three visual lines", "Built a deployment platform cutting\nrelease lead time across 12 teams and\nreducing rollback time by 40%", "deployment platform cutting release lead time across 12 teams and reducing rollback time"],
  ])("accepts honest evidence across a soft PDF wrap: %s", (_label, resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).not.toThrow();
  });
  it.each([
    ["employer rows", "Acme Corp Senior Engineer 2019-2024\nInitech Corp Staff Engineer 2015-2019", "2019-2024 Initech Corp"],
    ["plain heading", "PROFESSIONAL EXPERIENCE AND ACHIEVEMENTS\nBuilt CI pipelines", "ACHIEVEMENTS Built CI"],
    ["disclaimer row", "Built CI pipelines cutting deploy time 40%\nEvaluated Kubernetes but never deployed it", "deploy time 40% Evaluated Kubernetes"],
  ])("does not join separate unmarked PDF records: %s", (_label, resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).toThrow(/failed evidence validation/);
  });
  it.each([
    ["Led platform delivery at Acme Inc.\nacross twelve regions", "Acme Inc. across twelve regions"],
    ["Authorized to work in the U.S.\nwithout sponsorship", "U.S. without sponsorship"],
  ])("accepts an abbreviation-ending PDF wrap: %s", (resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).not.toThrow();
  });
  it.each([
    ["Led the AWS migration in 2021\nand mentored four engineers", "2021 and mentored four engineers"],
    ["Built CI pipelines;\nreduced deploy time 40%", "CI pipelines; reduced deploy time"],
    ["Delivered three programs:\nplatform, payments and identity", "programs: platform, payments"],
  ])("accepts lowercase continuation after a record-like ending: %s", (resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).not.toThrow();
  });
  it("does not weld a bullet achievement to a following employer record", () => {
    const resume = "- Led the migration of 200 services to containerized infrastructure\nInitech Corp Staff Engineer 2015-2019\nEDUCATION\nState University";
    const evidence = "containerized infrastructure Initech Corp Staff Engineer 2015-2019";
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).toThrow(/failed evidence validation/);
  });
  it("accepts a wrapped bullet whose continuation starts with a proper noun", () => {
    const resume = "• Migrated 200 services to containerized infrastructure using\nKubernetes and Terraform";
    const evidence = "Migrated 200 services to containerized infrastructure using Kubernetes and Terraform";
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).not.toThrow();
  });
  it.each([
    "Node.js at Acme",
    "3.5 years of Python",
    "AWS Solutions Architect (2024)",
    "C++ and Go",
    "$1.2M in cloud spend",
    "bash|zsh daily",
    "Authorized to work in the U.S.",
    "JSON {} parsers",
    "C++/C#",
    "$1.2M using .NET",
    "Skills: C++ * C# * Java",
    "Revenue up 40% * churn down 15% * NPS 62",
  ])("keeps punctuation-bearing verbatim evidence: %s", (evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), evidence)).not.toThrow();
  });
  it.each([
    ["Not only built CI pipelines but also owned releases", "built CI pipelines"],
    ["Never missed a deadline while owning the release process", "owning the release process"],
    ["No production experience but familiar with Rust", "familiar with Rust"],
    ["No Kubernetes and built CI pipelines", "built CI pipelines"],
    ["No Kubernetes, however built CI pipelines", "built CI pipelines"],
    ["Not only led the migration but also mentored four engineers", "led the migration"],
    ["Although not certified, led the platform team", "led the platform team"],
    ["Delivered no less than 12 releases in 2024", "12 releases in 2024"],
    ["Migrated with zero downtime and shipped Postgres migrations", "shipped Postgres migrations"],
  ])("accepts honest evidence beside an unrelated negator: %s", (resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).not.toThrow();
  });
  it("accepts an honest citation in a multi-line bullet resume with an unrelated denial", () => {
    const resume = "SKILLS\n- Python and SQL\n- No Kubernetes exposure\n- Built CI pipelines cutting\n  deploy time 40%";
    expect(() => assertTailorResultEvidence(resultForEvidence("Built CI pipelines cutting deploy time 40%"), resume)).not.toThrow();
  });
  it.each([
    "Only evaluated Kubernetes",
    "Beginner in Kubernetes",
    "Exposure to Kubernetes",
    "Aspiring to be a platform engineer",
    "Hope to become a platform engineer",
    "Failed to become certified",
    "Limited Kubernetes production experience",
  ])("does not allow qualified evidence to prove an unqualified claim: %s", (evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), evidence)).toThrow(/failed evidence validation/);
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence, "partially_supported"), evidence)).not.toThrow();
  });
  it.each([
    "Not yet proficient in Kubernetes",
    "Never yet shipped Kubernetes to production",
    "Not only lacking Kubernetes experience",
    "No less than zero experience with Rust",
  ])("does not let an exception hide a real denial: %s", (resume) => {
    const evidence = resume.includes("Rust") ? "zero experience with Rust" : resume.includes("experience") ? "Kubernetes experience" : resume.includes("certified") ? "certified in AWS" : resume.includes("shipped") ? "shipped Kubernetes to production" : "proficient in Kubernetes";
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).toThrow(/failed evidence validation/);
  });
  it("keeps yet as a conjunction when it does not intensify a negator", () => {
    expect(() => assertTailorResultEvidence(resultForEvidence("built CI pipelines"), "No Kubernetes yet built CI pipelines")).not.toThrow();
  });
  it.each([
    ["Minimal Kubernetes experience", "Kubernetes experience"],
    ["Limited Kubernetes experience", "Kubernetes experience"],
  ])("does not let a degree qualifier prove an unqualified claim: %s", (resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).toThrow(/failed evidence validation/);
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence, "partially_supported"), resume)).not.toThrow();
  });
  it.each([
    ["Minimal Kubernetes experience", "Kubernetes"],
    ["Minimal Kubernetes experience", "experience"],
    ["Limited hands-on Kubernetes background", "Kubernetes"],
  ])("does not evade a degree qualifier by shortening the citation: %s", (resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).toThrow(/failed evidence validation/);
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence, "partially_supported"), resume)).not.toThrow();
  });
  it.each([
    ["Senior Engineer at Contoso Limited with 9 years of experience shipping payments", "9 years of experience shipping payments"],
    ["Acme Limited - built CI pipelines cutting deploy time 40%. Skills: Python, SQL", "built CI pipelines cutting deploy time 40%"],
  ])("does not treat an incorporated employer as a degree qualifier: %s", (resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).not.toThrow();
  });
  it.each([
    ["Acme Limited built CI pipelines", "built CI pipelines"],
    ["Operated with minimal oversight across 12 regions", "oversight across 12 regions"],
    ["Advised a limited partnership on cloud spend", "partnership on cloud spend"],
  ])("does not mistake ordinary limited/minimal wording for a disclaimer: %s", (resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).not.toThrow();
  });
  it.each([
    ["Senior engineer using Node.js at Acme since 2021", "Node.js at Acme"],
    ["Managed $1.2M in cloud spend across three regions", "$1.2M in cloud spend"],
    ["Earned AWS Solutions Architect (2024) while leading migrations", "AWS Solutions Architect (2024)"],
  ])("keeps punctuation-bearing evidence inside surrounding text: %s", (resume, evidence) => {
    expect(() => assertTailorResultEvidence(resultForEvidence(evidence), resume)).not.toThrow();
  });
  it("matches visible text through nested Markdown emphasis", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: ["CI"] },
      requirement_evidence: [{ id: "delivery", requirement: "Delivery", category: "mandatory", state: "proven",
        evidence: ["Built CI pipelines"], tailoredText: ["Built CI pipelines"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\n**Built *CI* pipelines**",
    });
    expect(() => assertTailorResultEvidence(result, "Built CI pipelines")).not.toThrow();
  });
  it("matches visible text through Markdown links and inline code", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: ["Kubernetes"] },
      requirement_evidence: [{ id: "delivery", requirement: "Delivery", category: "mandatory", state: "proven",
        evidence: ["Built CI pipelines with Kubernetes at Acme"], tailoredText: ["Built CI pipelines with Kubernetes at Acme"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nBuilt CI pipelines with `Kubernetes` at [Acme](https://acme.example).",
    });
    expect(() => assertTailorResultEvidence(result, "Built CI pipelines with Kubernetes at Acme")).not.toThrow();
  });
  it("compares output text without treating a mid-line hyphen as a Markdown bullet", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: [] },
      requirement_evidence: [{ id: "sales", requirement: "Sales", category: "mandatory", state: "proven",
        evidence: ["Sales operations"], tailoredText: ["- Sales operations"], recommendation: "" }],
      tailored_resume_markdown: "# Jane Doe\nRegional Manager - Sales operations lead for the west region",
    });
    expect(() => assertTailorResultEvidence(result, "Sales operations")).not.toThrow();
  });
  it("summarizes failures without copying requirement ids, keywords, or document text", () => {
    const summary = summarizeHonestyViolations([
      "Requirement secret-id cites evidence absent from the original résumé.",
      "Requirement other-id references tailored text absent from the generated documents.",
      'Added keyword "private term" is absent from the generated documents.',
    ]);
    expect(summary).toEqual({ sourceCitationMismatch: 1, outputReferenceMismatch: 1, addedKeywordMismatch: 1 });
    expect(JSON.stringify(summary)).not.toMatch(/secret-id|other-id|private term/);
  });
  it("keeps worst-case evidence validation bounded", () => {
    const evidence = "Built CI pipelines cutting deploy time 40%";
    const requirements = Array.from({ length: 100 }, (_, index) => ({
      id: `delivery-${index}`,
      requirement: "Delivery",
      category: "mandatory" as const,
      state: "proven" as const,
      evidence: Array(5).fill(evidence) as string[],
      tailoredText: [evidence],
      recommendation: "",
    }));
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: [] },
      requirement_evidence: requirements,
      tailored_resume_markdown: `# Jane Doe\n${evidence}`,
    });
    const resume = `${"No Kubernetes exposure and unrelated context ".repeat(2_000)}${evidence}`;
    const started = performance.now();
    expect(() => assertTailorResultEvidence(result, resume)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(1_500);
  });
  it("keeps the all-negated repeated-occurrence path bounded", () => {
    const evidence = "production Kubernetes experience";
    const requirements = Array.from({ length: 100 }, (_, index) => ({
      id: `delivery-${index}`,
      requirement: "Delivery",
      category: "mandatory" as const,
      state: "proven" as const,
      evidence: Array(10).fill(evidence) as string[],
      tailoredText: [evidence],
      recommendation: "",
    }));
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: [] },
      requirement_evidence: requirements,
      tailored_resume_markdown: `# Jane Doe\n${evidence}`,
    });
    const resume = `- ${"No production Kubernetes experience. ".repeat(2_000)}`;
    const started = performance.now();
    expect(() => assertTailorResultEvidence(result, resume)).toThrow(/failed evidence validation/);
    expect(performance.now() - started).toBeLessThan(1_500);
  });
  it("caps model-supplied evidence work", () => {
    const tooManyRequirements = Array.from({ length: 101 }, (_, index) => ({
      id: `r-${index}`, requirement: "Requirement", category: "mandatory" as const,
      state: "proven" as const, evidence: ["Evidence"], tailoredText: ["Evidence"], recommendation: "",
    }));
    expect(() => TailorResultSchema.parse({ ...VALID_RESULT, requirement_evidence: tooManyRequirements })).toThrow();
    const tooManyCitations = { ...VALID_RESULT.requirement_evidence[0], state: "proven" as const, evidence: Array(11).fill("Evidence") };
    expect(() => TailorResultSchema.parse({ ...VALID_RESULT, requirement_evidence: [tooManyCitations] })).toThrow();
  });
  it("withholds fabricated evidence, missing output references, and phantom added keywords", () => {
    const result = TailorResultSchema.parse({
      ...VALID_RESULT,
      keywords: { ...VALID_RESULT.keywords, added: ["Kubernetes"] },
      requirement_evidence: [{ id: "k8s", requirement: "Kubernetes", category: "mandatory", state: "proven",
        evidence: ["Ran a 500-node Kubernetes platform"], tailoredText: ["Managed Kubernetes"], recommendation: "" }],
    });
    expect(() => assertTailorResultEvidence(result, "Engineer with CI pipeline experience.")).toThrow(/failed evidence validation/);
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
