import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeGoogleCode, googleOAuthConfig, openConnection, sealConnection, stateMatches, type GoogleTokenSet, type OAuthTransaction } from "@/lib/google-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url); const jar = await cookies();
  try {
    const error = url.searchParams.get("error"); if (error) throw new Error(`Google authorization was not completed (${error}).`);
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); const sealed = jar.get("rf_google_oauth")?.value;
    if (!code || !state || !sealed) throw new Error("Google callback is missing required authorization state.");
    const config = googleOAuthConfig(); const transaction = openConnection<OAuthTransaction>(sealed, config.encryptionKey);
    if (Date.now() - transaction.createdAt > 600_000 || !stateMatches(transaction.state, state)) throw new Error("Google authorization state is invalid or expired.");
    const tokens = await exchangeGoogleCode(config, code, transaction);
    jar.set("rf_google_connection", sealConnection({ tokens, features: transaction.features }, config.encryptionKey), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
    jar.delete("rf_google_oauth"); return NextResponse.redirect(new URL("/?google=connected", request.url));
  } catch (error) {
    jar.delete("rf_google_oauth"); const redirect = new URL("/", request.url); redirect.searchParams.set("google", "error");
    redirect.searchParams.set("reason", error instanceof Error ? error.message : "Google connection failed."); return NextResponse.redirect(redirect);
  }
}

export type StoredGoogleConnection = { tokens: GoogleTokenSet; features: string[] };
