import { describe, expect, it } from "vitest";
import { protectPii, restorePii } from "./pii";

describe("client-side PII protection", () => {
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
});
