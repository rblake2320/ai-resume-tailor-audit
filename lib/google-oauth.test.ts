import { describe, expect, it, vi } from "vitest";
import { createOAuthTransaction, exchangeGoogleCode, googleAuthorizationUrl, googleOAuthConfig, GOOGLE_SCOPES, openConnection, parseGoogleFeatures, sealConnection, stateMatches } from "./google-oauth";

const key = Buffer.alloc(32, 7);
const config = { clientId: "client", clientSecret: "secret", redirectUri: "http://localhost:3000/api/connections/google/callback", encryptionKey: key };
describe("Google OAuth boundary", () => {
  it("fails closed without every server-side secret", () => {
    expect(() => googleOAuthConfig({})).toThrow(/not configured/);
    expect(() => googleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: "x", GOOGLE_OAUTH_CLIENT_SECRET: "y", GOOGLE_OAUTH_REDIRECT_URI: "http://localhost", RESUME_FOUNDRY_CONNECTION_KEY: "bad" })).toThrow(/32 bytes/);
  });
  it("requests only explicitly selected feature scopes with PKCE and state", () => {
    const transaction = createOAuthTransaction(parseGoogleFeatures("email_alerts,calendar_events"), 1);
    const url = new URL(googleAuthorizationUrl(config, transaction));
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([GOOGLE_SCOPES.email_alerts, GOOGLE_SCOPES.calendar_events]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("state")).toBe(transaction.state);
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
  });
  it("authenticates encrypted server-side connection state and rejects tampering", () => {
    const sealed = sealConnection({ refresh: "never-client-visible" }, key);
    expect(sealed).not.toContain("never-client-visible"); expect(openConnection(sealed, key)).toEqual({ refresh: "never-client-visible" });
    const parts = sealed.split("."); parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
    expect(() => openConnection(parts.join("."), key)).toThrow(/authenticated/);
    expect(stateMatches("same", "same")).toBe(true); expect(stateMatches("same", "other")).toBe(false);
  });
  it("exchanges authorization code with verifier and validates granted scopes", async () => {
    const transaction = createOAuthTransaction(["email_drafts"]);
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain(`code_verifier=${transaction.verifier}`);
      return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: GOOGLE_SCOPES.email_drafts, token_type: "Bearer" }), { status: 200 });
    });
    expect((await exchangeGoogleCode(config, "code", transaction, request as typeof fetch)).refresh_token).toBe("refresh");
  });
});
