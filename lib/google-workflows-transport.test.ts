import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { executeGoogleWrite, readGoogleJobAlerts, type GoogleConnection } from "./google-workflows";
import { GOOGLE_SCOPES } from "./google-oauth";

describe("Google workflows actual local HTTP receiving fixture", () => {
  it("stores and independently retrieves a reviewed calendar event and unsent Gmail draft, and delivers text alert", async () => {
    let event: Record<string, unknown> = {}, draft: { message?: { raw: string } } = {};
    const calls: string[] = [];
    const server = createServer(async (req, res) => {
      calls.push(`${req.method} ${req.url}`);
      let text = ""; for await (const chunk of req) text += chunk;
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/calendar/v3/calendars/primary/events")) {
        if (req.method === "POST") { event = JSON.parse(text); res.end(JSON.stringify({ id: event.id })); }
        else res.end(JSON.stringify(event));
      } else if (req.url?.startsWith("/gmail/v1/users/me/drafts")) {
        if (req.method === "POST") { draft = JSON.parse(text); res.end(JSON.stringify({ id: "synthetic-draft" })); }
        else res.end(JSON.stringify({ id: "synthetic-draft", ...draft }));
      } else if (req.url?.startsWith("/gmail/v1/users/me/messages?")) res.end(JSON.stringify({ messages: [{ id: "alert1" }] }));
      else if (req.url === "/gmail/v1/users/me/messages/alert1?format=full") res.end(JSON.stringify({ id: "alert1", payload: { mimeType: "text/plain", headers: [{ name: "Subject", value: "Synthetic role" }], body: { data: Buffer.from("Native HTTP alert body").toString("base64url") } } }));
      else { res.statusCode = 404; res.end("{}"); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture listener.");
    const fixtureOrigin = `http://127.0.0.1:${address.port}`;
    const fetcher: typeof fetch = (url, init) => { const target = new URL(String(url)); return fetch(`${fixtureOrigin}${target.pathname}${target.search}`, init); };
    const connection: GoogleConnection = { features: ["email_alerts", "email_drafts", "calendar_events"], tokens: { access_token: "synthetic", expires_in: 3600, scope: Object.values(GOOGLE_SCOPES).join(" "), token_type: "Bearer", obtainedAt: Date.now() } };
    const id = "78e5f75a-885e-45ba-a25e-d35c7c75a125";
    try {
      expect(await executeGoogleWrite(connection, { type: "calendar_event", title: "Interview fixture", description: "Reviewed synthetic notes", start: "2026-10-01T13:00:00Z", end: "2026-10-01T14:00:00Z", reminderMinutes: 30 }, id, fetcher)).toMatchObject({ verified: true });
      expect(event).toMatchObject({ summary: "Interview fixture", visibility: "private", reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] } });
      expect(event).not.toHaveProperty("attendees");
      expect(await executeGoogleWrite(connection, { type: "email_draft", to: "synthetic@example.test", subject: "Follow-up", body: "Reviewed fixture message" }, id, fetcher)).toMatchObject({ verified: true, sent: false });
      expect((await readGoogleJobAlerts(connection, "job", fetcher))[0].text).toBe("Native HTTP alert body");
      expect(calls).toHaveLength(6);
      expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(2);
      expect(calls.some((call) => call.includes("/send"))).toBe(false);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
