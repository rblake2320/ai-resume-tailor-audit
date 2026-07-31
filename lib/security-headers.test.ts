import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { NextRequest } from "next/server";
import { contentSecurityPolicy, proxy } from "../proxy";

describe("production security headers", () => {
  it("denies framing, sniffing, and unnecessary browser capabilities", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers?.();
    const headers = new Map(rules?.[0]?.headers.map(({ key, value }) => [key.toLowerCase(), value]));
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("permissions-policy")).toContain("camera=()");
    expect(headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("generates a fresh executable-script nonce without unsafe-inline", () => {
    const first = proxy(new NextRequest("https://app.test/"));
    const second = proxy(new NextRequest("https://app.test/"));
    const firstPolicy = first.headers.get("content-security-policy")!;
    expect(firstPolicy).toContain("frame-ancestors 'none'");
    expect(firstPolicy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(firstPolicy.match(/script-src[^;]+/)?.[0]).not.toContain("'unsafe-inline'");
    expect(second.headers.get("content-security-policy")).not.toBe(firstPolicy);
    expect(contentSecurityPolicy("fixed", false)).not.toContain("unsafe-eval");
  });
});
