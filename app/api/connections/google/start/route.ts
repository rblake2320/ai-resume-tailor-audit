import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createOAuthTransaction, googleAuthorizationUrl, googleOAuthConfig, parseGoogleFeatures, sealConnection } from "@/lib/google-oauth";

export async function GET(request: Request) {
  try {
    const config = googleOAuthConfig(); const features = parseGoogleFeatures(new URL(request.url).searchParams.get("features"));
    const transaction = createOAuthTransaction(features); const jar = await cookies();
    jar.set("rf_google_oauth", sealConnection(transaction, config.encryptionKey), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/connections/google", maxAge: 600 });
    return NextResponse.redirect(googleAuthorizationUrl(config, transaction));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Google connection failed." }, { status: 503 }); }
}
