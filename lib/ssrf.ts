import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Server-side SSRF guard. The previous check regex-matched the hostname string,
// so numeric/alternate encodings (e.g. http://2130706433 == 127.0.0.1),
// DNS names resolving to private space, and redirect-to-private all slipped
// through. This resolves the host to real IP(s) and validates every address.

export class SsrfError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "SsrfError";
  }
}

function blockedV4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // not a clean dotted quad -> treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
  return false;
}

/** Expand any IPv6 form (compressed, hex, or with embedded dotted IPv4) to 16 bytes. */
function expandV6(raw: string): number[] | null {
  let ip = raw.toLowerCase().split("%")[0]; // drop zone id
  // Fold a trailing embedded dotted IPv4 (e.g. ::ffff:127.0.0.1) into hextets.
  const dotted = ip.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const q = dotted[2].split(".").map(Number);
    if (q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    ip = dotted[1] +
      (((q[0] << 8) | q[1]).toString(16)) + ":" + (((q[2] << 8) | q[3]).toString(16));
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const v = parseInt(g || "0", 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff || !/^[0-9a-f]{1,4}$/.test(g || "0")) return null;
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function blockedV6(raw: string): boolean {
  const b = expandV6(raw);
  if (!b) return true; // unparseable -> block
  const allZeroBut = (n: number) => b.slice(0, n).every((x) => x === 0);
  if (allZeroBut(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 2002::/16 6to4 embeds IPv4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // Teredo
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // deprecated site-local fec0::/10
  const nat64Prefix = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];
  if (b.slice(0, 12).every((value, index) => value === nat64Prefix[index])) {
    return blockedV4(b.slice(12).join("."));
  }
  // v4-mapped (::ffff:a.b.c.d) or v4-compatible (::a.b.c.d): validate embedded v4.
  if (allZeroBut(10) && b[10] === 0xff && b[11] === 0xff) {
    return blockedV4(b.slice(12).join("."));
  }
  if (allZeroBut(12)) return blockedV4(b.slice(12).join("."));
  return false;
}

function blockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blockedV4(ip);
  if (v === 6) return blockedV6(ip);
  return true; // unrecognized -> block
}

/**
 * Validate that `raw` is a public http(s) URL whose host resolves only to
 * public addresses. Throws SsrfError otherwise. Returns the parsed URL and the
 * resolved public IPs.
 */
export async function assertPublicUrl(raw: string): Promise<{ url: URL; ips: string[] }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("bad_protocol");
  if (url.username || url.password) throw new SsrfError("credentials"); // no user:pass@

  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, ""); // unwrap [ipv6]
  let ips: string[];
  if (isIP(host)) {
    ips = [host];
  } else {
    // `verbatim: false` so we see the same ordering the OS resolver returns;
    // getaddrinfo also normalizes numeric forms (decimal/hex/octal) to real IPs.
    const results = await lookup(host, { all: true }).catch(() => {
      throw new SsrfError("dns");
    });
    ips = results.map((r) => r.address);
    if (ips.length === 0) throw new SsrfError("dns");
  }
  for (const ip of ips) {
    if (blockedIp(ip)) throw new SsrfError("blocked_ip");
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") throw new SsrfError("bad_port");
  return { url, ips };
}

/**
 * Fetch a validated public URL, re-validating every redirect hop against the
 * SSRF guard (a public page must not be able to bounce us to 127.0.0.1). Caps
 * redirects. Non-http(s) or private redirect targets throw SsrfError.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const { url } = await assertPublicUrl(current);
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      await res.body?.cancel("redirect response not consumed").catch(() => undefined);
      current = new URL(location, url).href; // resolve relative redirects
      continue;
    }
    return res;
  }
  throw new SsrfError("too_many_redirects");
}
