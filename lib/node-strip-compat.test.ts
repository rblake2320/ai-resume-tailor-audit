import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Node strip-only compatibility", () => {
  it("loads schema.ts without unsupported TypeScript runtime syntax", () => {
    const schemaUrl = new URL("./schema.ts", import.meta.url).href;
    const output = execFileSync(process.execPath, [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(schemaUrl)}); process.stdout.write("loaded")`,
    ], { encoding: "utf8" });
    expect(output).toBe("loaded");
  });
});
