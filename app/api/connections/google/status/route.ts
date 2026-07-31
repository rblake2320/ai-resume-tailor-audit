import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { googleOAuthConfig, openConnection } from "@/lib/google-oauth";
import type { StoredGoogleConnection } from "../callback/route";

export async function GET() {
  const sealed = (await cookies()).get("rf_google_connection")?.value;
  if (!sealed) return NextResponse.json({ connected: false, configured: configured() });
  try {
    const value = openConnection<StoredGoogleConnection>(sealed, googleOAuthConfig().encryptionKey);
    return NextResponse.json({ connected: true, configured: true, features: value.features,
      scopes: value.tokens.scope.split(" "), expiresAt: new Date(value.tokens.obtainedAt + value.tokens.expires_in * 1000).toISOString(),
      hasRefreshToken: Boolean(value.tokens.refresh_token) });
  } catch { return NextResponse.json({ connected: false, configured: configured(), error: "Stored Google connection is unavailable or invalid." }, { status: 409 }); }
}

function configured() { try { googleOAuthConfig(); return true; } catch { return false; } }
