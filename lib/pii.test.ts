import { afterEach, describe, expect, it, vi } from "vitest";
import { protectPii, restorePii } from "./pii";

describe("client-side PII protection", () => {
  afterEach(() => vi.restoreAllMocks());
  it("replaces common contact data before transmission and restores it afterward", () => {
    const source = "Jane Doe · jane@example.com · (512) 555-0199 · https://linkedin.com/in/jane";
    const protectedValue = protectPii(source);
    expect(protectedValue.text).not.toContain("jane@example.com");
    expect(protectedValue.text).not.toContain("555-0199");
    expect(protectedValue.matches.map((match) => match.kind)).toEqual(["email", "phone", "web profile"]);
    expect(restorePii({ resume: protectedValue.text }, protectedValue.matches).resume).toBe(source);
  });

  it("flags government identifiers and street addresses", () => {
    const protectedValue = protectPii("SSN 123-45-6789, 123 Main Street");
    expect(protectedValue.matches.map((match) => match.kind)).toContain("government identifier");
    expect(protectedValue.matches.map((match) => match.kind)).toContain("street address");
  });

  it("protects LinkedIn profiles with or without a URL scheme", () => {
    for (const value of ["linkedin.com/in/jane-doe", "https://www.linkedin.com/in/jane-doe"]) {
      const protectedValue = protectPii(value);
      expect(protectedValue.matches).toHaveLength(1);
      expect(protectedValue.matches[0].kind).toBe("web profile");
      expect(protectedValue.text).not.toContain("jane-doe");
    }
  });

  it.each([
    "5551234567",
    "(555)1234567",
    "+44 20 7123 4567",
  ])("protects defensible compact and international phone form %s", (value) => {
    const protectedValue = protectPii(`Call ${value} for an interview.`);
    expect(protectedValue.matches.map((match) => match.kind)).toContain("phone");
    expect(protectedValue.text).not.toContain(value);
    expect(restorePii(protectedValue.text, protectedValue.matches)).toContain(value);
  });

  it.each(["123456789", "123 45 6789"])(
    "protects compact and spaced government identifier form %s",
    (value) => {
      const protectedValue = protectPii(`SSN ${value}`);
      expect(protectedValue.matches.map((match) => match.kind)).toContain("government identifier");
      expect(protectedValue.text).not.toContain(value);
    },
  );

  it("does not misclassify dates, short numbers, or long account numbers as phones or SSNs", () => {
    const source = "Dates 2026-07-31 and 07/31/2026; ZIP 78701; account 1234567890123456; candidate ABC5551234567XYZ; employee E123456789Z.";
    expect(protectPii(source)).toEqual({ text: source, matches: [] });
  });

  it("masks only explicit caller-supplied candidate names and restores exact casing", () => {
    const source = "JANE   DOE led delivery. Jane Doe mentored peers. Jane documented it.";
    const protectedValue = protectPii(source, { candidateNames: ["Jane Doe"] });
    expect(protectedValue.text).not.toMatch(/jane\s+doe/i);
    expect(protectedValue.text).toContain("Jane documented it.");
    expect(protectedValue.matches.filter((match) => match.kind === "candidate name")).toHaveLength(2);
    expect(restorePii(protectedValue.text, protectedValue.matches)).toBe(source);
  });

  it("does not guess personal names when the caller supplies none", () => {
    const source = "Jane Doe led delivery.";
    expect(protectPii(source)).toEqual({ text: source, matches: [] });
  });

  it("masks canonically equivalent Unicode forms and restores the original text", () => {
    const source = "JOSE\u0301 NU\u0301N\u0303EZ led delivery.";
    const protectedValue = protectPii(source, { candidateNames: ["José Núñez"] });
    expect(protectedValue.matches.map((match) => match.kind)).toEqual(["candidate name"]);
    expect(protectedValue.text).not.toContain("JOSE\u0301");
    expect(restorePii(protectedValue.text, protectedValue.matches)).toBe(source);
  });

  it.each([
    "JOSÉ NU\u0301N\u0303EZ",
    "JOSE\u0301 NÚÑEZ",
  ])("masks mixed per-grapheme NFC/NFD candidate name %s", (name) => {
    const source = `${name} led delivery.`;
    const protectedValue = protectPii(source, { candidateNames: ["José Núñez"] });
    expect(protectedValue.matches.map((match) => match.kind)).toEqual(["candidate name"]);
    expect(restorePii(protectedValue.text, protectedValue.matches)).toBe(source);
  });

  it.each(["555\u00a0123\u00a04567", "123\u00a045\u00a06789"])(
    "protects non-breaking-space-delimited personal data %s",
    (value) => {
      const protectedValue = protectPii(value);
      expect(protectedValue.matches).toHaveLength(1);
      expect(protectedValue.text).not.toContain(value);
      expect(restorePii(protectedValue.text, protectedValue.matches)).toBe(value);
    },
  );

  it("uses collision-resistant tokens and never restores model-added repetitions", () => {
    const source = "Jane Doe [[RF_CANDIDATE_NAME_1]]";
    const protectedValue = protectPii(source, { candidateNames: ["Jane Doe"] });
    expect(protectedValue.text).toContain("[[RF_CANDIDATE_NAME_1]]");
    expect(protectedValue.matches[0].token).not.toBe("[[RF_CANDIDATE_NAME_1]]");
    expect(restorePii(protectedValue.text, protectedValue.matches)).toBe(source);

    const repeatedByModel = `${protectedValue.text} ${protectedValue.matches[0].token}`;
    expect(restorePii(repeatedByModel, protectedValue.matches)).toBe(
      `${source} [Personal information withheld: unexpected repeated candidate name placeholder]`,
    );
  });

  it("regenerates a random prefix that already occurs in the source", () => {
    const random = vi.spyOn(globalThis.crypto, "getRandomValues");
    random.mockImplementationOnce((array) => { (array as Uint8Array).fill(0); return array; });
    random.mockImplementationOnce((array) => { (array as Uint8Array).fill(1); return array; });
    const collidingLiteral = `[[RF_${"00".repeat(16)}_CANDIDATE_NAME_1]]`;
    const source = `${collidingLiteral} Jane Doe`;
    const protectedValue = protectPii(source, { candidateNames: ["Jane Doe"] });
    expect(protectedValue.matches[0].token).toContain("01".repeat(16));
    expect(restorePii(protectedValue.text, protectedValue.matches)).toBe(source);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it("does not classify arbitrary project or employer URLs as personal profiles", () => {
    const source = "https://docs.example.com/project/runbook";
    expect(protectPii(source)).toEqual({ text: source, matches: [] });
  });

  it("masks only root GitHub/GitLab user profiles, not repositories or groups", () => {
    for (const profile of ["https://github.com/jane-doe", "https://gitlab.com/jane.doe"]) {
      expect(protectPii(profile).matches.map((match) => match.kind)).toEqual(["web profile"]);
    }
    for (const project of ["https://github.com/jane-doe/resume", "https://gitlab.com/team/project"]) {
      expect(protectPii(project)).toEqual({ text: project, matches: [] });
    }
  });

  it("restores document fields in a deterministic priority and surfaces excess placeholders", () => {
    const protectedValue = protectPii("Jane Doe", { candidateNames: ["Jane Doe"] });
    const token = protectedValue.matches[0].token;
    const first = restorePii({ cover_letter_markdown: token, tailored_resume_markdown: token }, protectedValue.matches);
    const second = restorePii({ tailored_resume_markdown: token, cover_letter_markdown: token }, protectedValue.matches);
    const withheld = "[Personal information withheld: unexpected repeated candidate name placeholder]";
    expect(first).toEqual({ tailored_resume_markdown: "Jane Doe", cover_letter_markdown: withheld });
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("[[RF_");
  });
});
