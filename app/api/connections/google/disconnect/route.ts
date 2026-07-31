import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== expectedOrigin || (fetchSite !== null && fetchSite !== "same-origin")) {
    return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
  }
  const jar = await cookies();
  jar.delete("rf_google_connection");
  jar.delete("rf_google_oauth");
  return NextResponse.json({ connected: false });
}
