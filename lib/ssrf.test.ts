import { describe, expect, it } from "vitest";
import { assertPublicUrl, SsrfError } from "./ssrf";

async function reason(raw: string): Promise<string> {
  try {
    await assertPublicUrl(raw);
    return "ALLOWED";
  } catch (e) {
    return e instanceof SsrfError ? e.reason : "OTHER";
  }
}

describe("assertPublicUrl — SSRF guard", () => {
  it("blocks loopback and private literals", async () => {
    for (const u of [
      "http://127.0.0.1/",
      "http://127.0.0.2:3789/",
      "http://10.0.0.5/",
      "http://192.168.1.10/",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://0.0.0.0/",
      "http://100.64.0.1/", // CGNAT
    ]) {
      expect(await reason(u)).toBe("blocked_ip");
    }
  });

  it("blocks numeric/alternate encodings of loopback (the reported bypass)", async () => {
    for (const u of [
      "http://2130706433:3789/", // decimal 127.0.0.1
      "http://0x7f000001/", // hex 127.0.0.1
      "http://017700000001/", // octal 127.0.0.1
    ]) {
      expect(await reason(u)).toBe("blocked_ip");
    }
  });

  it("blocks IPv6 loopback, link-local, ULA, and v4-mapped loopback", async () => {
    for (const u of [
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://[2002:7f00:1::]/",
      "http://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]/",
      "http://[fec0::1]/",
    ]) {
      expect(await reason(u)).toBe("blocked_ip");
    }
  });

  it("restricts outbound job fetching to standard web ports", async () => {
    expect(await reason("https://8.8.8.8:8443/jobs")).toBe("bad_port");
  });

  it("rejects non-http(s) protocols", async () => {
    for (const u of ["file:///etc/passwd", "data:text/html,x", "ftp://example.com/", "gopher://x/"]) {
      expect(await reason(u)).toBe("bad_protocol");
    }
    // javascript: has no host; URL parses but protocol is rejected.
    expect(await reason("javascript:alert(1)")).toBe("bad_protocol");
  });

  it("rejects credential-bearing and malformed URLs", async () => {
    expect(await reason("http://user:pass@127.0.0.1/")).toBe("credentials");
    expect(await reason("http://user:pass@example.com/")).toBe("credentials");
    expect(await reason("not a url")).toBe("invalid_url");
    expect(await reason("http://")).toBe("invalid_url");
  });

  it("allows a public literal address", async () => {
    // Literal public IPs need no DNS; 8.8.8.8 is public.
    expect(await reason("http://8.8.8.8/careers")).toBe("ALLOWED");
    expect(await reason("https://93.184.216.34/")).toBe("ALLOWED"); // public literal
  });
});
