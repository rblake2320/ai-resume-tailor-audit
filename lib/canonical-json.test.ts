import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  it("orders keys by code unit, not by locale", () => {
    // Regression: packet checksums ordered keys with `localeCompare`, which puts
    // "a" before "A" under en-US but after it by code unit. Employer-supplied
    // screening-question names reach that sort, so the same packet could hash
    // differently on two hosts and fail verification on the second.
    expect(canonicalJson({ a: 1, A: 2 })).toBe('{"A":2,"a":1}');
    expect("a".localeCompare("A")).toBe(-1); // pins the divergent behaviour
  });

  it("is independent of insertion order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("preserves array order and nests objects", () => {
    expect(canonicalJson({ list: [{ b: 1, a: 2 }, "x"] })).toBe('{"list":[{"a":2,"b":1},"x"]}');
  });

  it("drops undefined members rather than emitting invalid JSON", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("refuses values that cannot be signed deterministically", () => {
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/Non-finite/);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(/Non-finite/);
  });
});
