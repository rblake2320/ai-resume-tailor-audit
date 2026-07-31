import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("production security headers", () => {
  it("denies framing, sniffing, and unnecessary browser capabilities", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers?.();
    const headers = new Map(rules?.[0]?.headers.map(({ key, value }) => [key.toLowerCase(), value]));
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("permissions-policy")).toContain("camera=()");
    expect(headers.get("strict-transport-security")).toContain("max-age=31536000");
  });
});
