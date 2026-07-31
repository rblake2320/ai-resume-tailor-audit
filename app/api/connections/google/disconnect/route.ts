import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export function isSameOriginMutation(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;
  let expectedOrigin: string;
  try {
    const configured = env.RESUME_FOUNDRY_PUBLIC_ORIGIN?.trim();
    expectedOrigin = configured ? new URL(configured).origin : new URL(request.url).origin;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return suppliedOrigin === expectedOrigin && (fetchSite === null || fetchSite === "same-origin");
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
  }
  const jar = await cookies();
  jar.delete("rf_google_connection");
  jar.delete("rf_google_oauth");
  return NextResponse.json({ connected: false });
}
