import { NextRequest, NextResponse } from "next/server";
import { pilotBoundary } from "./lib/pilot-boundary";

export function contentSecurityPolicy(nonce: string, development = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // The client currently uses four React style attributes. A script nonce
    // cannot authorize style attributes; keep this scoped exception explicit.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const denied = pilotBoundary(request);
  if (denied) return denied;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  // Pilot origin admission includes static assets and prefetch requests.
  matcher: ["/:path*"],
};
