import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, resolveModel, resolveOutputBudget } from "./anthropic-model";

describe("deployment output budget", () => {
  it("has a bounded default and rejects invalid deployment limits", () => {
    expect(resolveOutputBudget({})).toBe(16_000);
    expect(resolveOutputBudget({ RESUME_FOUNDRY_MAX_OUTPUT_TOKENS: "4096" })).toBe(4096);
    for (const value of ["0", "-1", "1.5", "Infinity", "64001", "garbage"]) expect(() => resolveOutputBudget({ RESUME_FOUNDRY_MAX_OUTPUT_TOKENS: value })).toThrow(/integer/);
  });
});

describe("Anthropic model resolution", () => {
  it("ignores ANTHROPIC_MODEL so a CLI alias cannot hijack the production route", () => {
    // Regression: the resolver used to fall back to ANTHROPIC_MODEL, which the
    // Claude Code CLI sets globally. On a developer machine it resolved to
    // "opusplan" — not a valid API model id — so every tailoring request was
    // sent with a broken model by default.
    expect(resolveModel({ ANTHROPIC_MODEL: "opusplan" })).toBe(DEFAULT_MODEL);
    expect(resolveModel({ ANTHROPIC_MODEL: "claude-sonnet-5" })).toBe(DEFAULT_MODEL);
  });

  it("defaults to claude-opus-5 when nothing is configured", () => {
    expect(resolveModel({})).toBe("claude-opus-5");
    expect(resolveModel({ RESUME_FOUNDRY_ANTHROPIC_MODEL: "   " })).toBe("claude-opus-5");
  });

  it("honours a valid app-specific override", () => {
    expect(resolveModel({ RESUME_FOUNDRY_ANTHROPIC_MODEL: "claude-sonnet-5" })).toBe("claude-sonnet-5");
    expect(resolveModel({ RESUME_FOUNDRY_ANTHROPIC_MODEL: " claude-haiku-4-5-20251001 " })).toBe("claude-haiku-4-5-20251001");
  });

  it("rejects CLI aliases and other non-model identifiers with an actionable error", () => {
    for (const alias of ["opusplan", "opus", "sonnet", "default", "haiku"]) {
      expect(() => resolveModel({ RESUME_FOUNDRY_ANTHROPIC_MODEL: alias })).toThrow(/not a valid Anthropic model id/);
    }
  });
});
