import { describe, expect, it, vi } from "vitest";
import { exchangeGoogleCode, GOOGLE_SCOPES, parseGoogleFeatures } from "./google-oauth";
import { fetchGreenhouse } from "./job-connectors";

const config = { clientId: "synthetic", clientSecret: "synthetic", redirectUri: "http://localhost/callback", encryptionKey: Buffer.alloc(32) };
const transaction = { state: "synthetic", verifier: "synthetic", features: ["email_drafts" as const], createdAt: Date.now() };

describe("independent security-team external boundaries", () => {
  it("rejects inherited property names as OAuth features", () => {
    for (const feature of ["constructor", "toString", "__proto__"]) {
      expect(() => parseGoogleFeatures(feature)).toThrow(/supported/);
    }
  });
  it("rejects malformed OAuth token types and expired token responses", async () => {
    const valid = { access_token: "synthetic", expires_in: 3600, scope: GOOGLE_SCOPES.email_drafts, token_type: "Bearer" };
    for (const patch of [{ access_token: 1 }, { expires_in: -1 }, { expires_in: "3600" }, { refresh_token: {} }]) {
      const request = vi.fn(async () => Response.json({ ...valid, ...patch }));
      await expect(exchangeGoogleCode(config, "synthetic", transaction, request)).rejects.toThrow(/token response/);
    }
  });
  it("bounds provider response bytes before importing jobs", async () => {
    const request = vi.fn(async () => new Response('{"jobs":[]}', { headers: { "content-length": "999999999" } }));
    await expect(fetchGreenhouse("synthetic", request)).rejects.toThrow(/too large/);
  });
  it("requires provider request deadline and rejects redirect-following", async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.redirect).toBe("error");
      return Response.json({ jobs: [] });
    });
    expect(await fetchGreenhouse("synthetic", request)).toEqual([]);
  });
});
