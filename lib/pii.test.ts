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
});
