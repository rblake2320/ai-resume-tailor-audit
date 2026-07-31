import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type GoogleFeature = "email_alerts" | "email_drafts" | "calendar_events";
export const GOOGLE_SCOPES: Record<GoogleFeature, string> = {
  email_alerts: "https://www.googleapis.com/auth/gmail.readonly",
  email_drafts: "https://www.googleapis.com/auth/gmail.compose",
  calendar_events: "https://www.googleapis.com/auth/calendar.events.owned",
};

export interface GoogleOAuthConfig { clientId: string; clientSecret: string; redirectUri: string; encryptionKey: Buffer }
export interface OAuthTransaction { state: string; verifier: string; features: GoogleFeature[]; createdAt: number }
export interface GoogleTokenSet { access_token: string; refresh_token?: string; expires_in: number; scope: string; token_type: string; obtainedAt: number }

export function googleOAuthConfig(env: Partial<Record<string, string | undefined>> = process.env): GoogleOAuthConfig {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim(); const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI?.trim(); const encodedKey = env.RESUME_FOUNDRY_CONNECTION_KEY?.trim();
  if (!clientId || !clientSecret || !redirectUri || !encodedKey) throw new Error("Google connection is not configured.");
  const encryptionKey = Buffer.from(encodedKey, "base64url");
  if (encryptionKey.length !== 32) throw new Error("RESUME_FOUNDRY_CONNECTION_KEY must decode to exactly 32 bytes.");
  return { clientId, clientSecret, redirectUri, encryptionKey };
}

export function parseGoogleFeatures(value: string | null): GoogleFeature[] {
  const requested = [...new Set((value ?? "").split(",").filter(Boolean))];
  if (!requested.length || requested.some((entry) => !(entry in GOOGLE_SCOPES))) throw new Error("Choose at least one supported Google connection feature.");
  return requested as GoogleFeature[];
}

export function createOAuthTransaction(features: GoogleFeature[], now = Date.now()): OAuthTransaction {
  return { state: randomBytes(32).toString("base64url"), verifier: randomBytes(48).toString("base64url"), features: [...features], createdAt: now };
}

export function googleAuthorizationUrl(config: GoogleOAuthConfig, transaction: OAuthTransaction): string {
  const challenge = createHash("sha256").update(transaction.verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code",
    scope: transaction.features.map((feature) => GOOGLE_SCOPES[feature]).join(" "), state: transaction.state,
    code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent",
    include_granted_scopes: "false" }).toString();
  return url.toString();
}

export function stateMatches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected); const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sealConnection(value: unknown, key: Buffer): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function openConnection<T>(sealed: string, key: Buffer): T {
  try {
    const [iv, tag, ciphertext] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
    if (!iv || !tag || !ciphertext) throw new Error("invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as T;
  } catch { throw new Error("Stored connection could not be authenticated."); }
}

export async function exchangeGoogleCode(config: GoogleOAuthConfig, code: string, transaction: OAuthTransaction,
  request: typeof fetch = fetch): Promise<GoogleTokenSet> {
  const response = await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: transaction.verifier,
      grant_type: "authorization_code", redirect_uri: config.redirectUri }) });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}).`);
  const value = await response.json() as Partial<GoogleTokenSet>;
  if (!value.access_token || !value.expires_in || !value.scope || value.token_type !== "Bearer") throw new Error("Google returned an incomplete token response.");
  const granted = new Set(value.scope.split(" ")); const expected = transaction.features.map((feature) => GOOGLE_SCOPES[feature]);
  if (expected.some((scope) => !granted.has(scope))) throw new Error("Google did not grant every requested scope.");
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_in: value.expires_in,
    scope: value.scope, token_type: value.token_type, obtainedAt: Date.now() };
}
