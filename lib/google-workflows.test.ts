import { describe, expect, it, vi } from "vitest";
import { executeGoogleWrite, freshGoogleConnection, GoogleWriteActionSchema, readGoogleJobAlerts, type GoogleConnection } from "./google-workflows";
import { GOOGLE_SCOPES } from "./google-oauth";

const connection: GoogleConnection = { features: ["email_alerts", "email_drafts", "calendar_events"], tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, obtainedAt: Date.now(), token_type: "Bearer", scope: Object.values(GOOGLE_SCOPES).join(" ") } };
const config = { clientId: "synthetic", clientSecret: "synthetic", redirectUri: "http://localhost/callback", encryptionKey: Buffer.alloc(32) };
const id = "78e5f75a-885e-45ba-a25e-d35c7c75a125";
const event = { type: "calendar_event" as const, title: "Synthetic interview", description: "Reviewed notes", start: "2026-10-01T13:00:00.000Z", end: "2026-10-01T14:00:00.000Z", reminderMinutes: 30 };

describe("Google receiving workflows", () => {
  it("reads at most ten selected text alerts without fetching attachments or running markup", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ messages: [{ id: "message1" }] })).mockResolvedValueOnce(Response.json({ id: "message1", payload: { mimeType: "multipart/alternative", headers: [{ name: "Subject", value: "Job alert" }, { name: "From", value: "alerts@example.test" }], parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Synthetic job " + "experience ".repeat(15)).toString("base64url") } }, { mimeType: "text/html", body: { data: Buffer.from("<script>unsafe</script>").toString("base64url") } }] } }));
    const alerts = await readGoogleJobAlerts(connection, 'subject:"job alert"', fetcher);
    expect(alerts[0]).toMatchObject({ id: "message1", subject: "Job alert" });
    expect(alerts[0].text).not.toContain("script");
    expect(fetcher.mock.calls[0][0]).toContain("maxResults=10");
    expect(fetcher.mock.calls[1][0]).toContain("format=full");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects omitted permissions before any network request", async () => {
    const fetcher = vi.fn();
    const unauthorized = { ...connection, features: [] } as GoogleConnection;
    await expect(readGoogleJobAlerts(unauthorized, "job", fetcher)).rejects.toThrow(/permission/);
    await expect(executeGoogleWrite(unauthorized, event, id, fetcher)).rejects.toThrow(/permission/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refreshes expired access without losing original refresh token and checks scopes", async () => {
    const expired = { ...connection, tokens: { ...connection.tokens, obtainedAt: 0 } };
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      return Response.json({ access_token: "new-synthetic", expires_in: 3600, token_type: "Bearer" });
    });
    expect((await freshGoogleConnection(expired, config, fetcher)).tokens.refresh_token).toBe("synthetic-refresh");
    const narrowed = vi.fn(async () => Response.json({ access_token: "synthetic", expires_in: 3600, token_type: "Bearer", scope: GOOGLE_SCOPES.email_alerts }));
    await expect(freshGoogleConnection(expired, config, narrowed)).rejects.toThrow(/permission/);
  });
  it("creates a private Calendar event with only reviewed popup reminder and verifies receiving-side contents", async () => {
    let body: Record<string, unknown>;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") { body = JSON.parse(String(init.body)); expect(body).not.toHaveProperty("attendees"); expect(body.visibility).toBe("private"); return Response.json({ id: id.replaceAll("-", "") }); }
      return Response.json(body!);
    });
    expect(await executeGoogleWrite(connection, event, id, fetcher)).toMatchObject({ verified: true, providerId: id.replaceAll("-", "") });
    expect(fetcher.mock.calls[0][0]).toContain("calendars/primary/events?sendUpdates=none");
    expect(fetcher.mock.calls[1][0]).toContain(`/events/${id.replaceAll("-", "")}`);
  });
  it("refuses a valid-looking Calendar success whose read-back event differs", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: id.replaceAll("-", "") })).mockResolvedValueOnce(Response.json({ id: id.replaceAll("-", ""), summary: "Substituted", description: event.description, start: { dateTime: event.start }, end: { dateTime: event.end }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] } }));
    await expect(executeGoogleWrite(connection, event, id, fetcher)).rejects.toThrow(/read-back/);
  });
  it("creates only an unsent draft and verifies exact reviewed content by read-back", async () => {
    let raw = "";
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") { raw = JSON.parse(String(init.body)).message.raw; return Response.json({ id: "draft1" }); }
      return Response.json({ id: "draft1", message: { raw } });
    });
    const draft = { type: "email_draft" as const, to: "employer@example.test", subject: "Follow-up résumé", body: "Synthetic reviewed message." };
    expect(await executeGoogleWrite(connection, draft, id, fetcher)).toMatchObject({ verified: true, sent: false, providerId: "draft1" });
    expect(fetcher.mock.calls[0][0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/send"))).toBe(false);
    expect(Buffer.from(raw, "base64url").toString()).toContain(`X-Resume-Foundry-Approval: ${id}`);
  });
  it("rejects header injection, extra privileged fields, oversized bodies and out-of-order event times", () => {
    expect(GoogleWriteActionSchema.safeParse({ type: "email_draft", to: "a@example.test", subject: "safe\r\nBcc: other@example.test", body: "body" }).success).toBe(false);
    expect(GoogleWriteActionSchema.safeParse({ ...event, attendees: [{ email: "other@example.test" }] }).success).toBe(false);
    expect(GoogleWriteActionSchema.safeParse({ ...event, end: event.start }).success).toBe(false);
    expect(GoogleWriteActionSchema.safeParse({ type: "email_draft", to: "a@example.test", subject: "subject", body: "x".repeat(1001) }).success).toBe(false);
  });
  it("rejects message identity mismatches and excessive MIME depth", async () => {
    const mismatch = vi.fn().mockResolvedValueOnce(Response.json({ messages: [{ id: "message1" }] })).mockResolvedValueOnce(Response.json({ id: "message2", payload: {} }));
    await expect(readGoogleJobAlerts(connection, "job", mismatch)).rejects.toThrow(/different identifier/);
    let payload: unknown = { mimeType: "text/plain", body: { data: "eA" } };
    for (let i = 0; i < 7; i++) payload = { parts: [payload] };
    const deep = vi.fn().mockResolvedValueOnce(Response.json({ messages: [{ id: "message1" }] })).mockResolvedValueOnce(Response.json({ id: "message1", payload }));
    await expect(readGoogleJobAlerts(connection, "job", deep)).rejects.toThrow(/nesting/);
  });
  it("folds long Unicode subjects into valid encoded words without losing reviewed content", async () => {
    let raw = "";
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") { raw = JSON.parse(String(init.body)).message.raw; return Response.json({ id: "draft1" }); }
      return Response.json({ id: "draft1", message: { raw } });
    });
    const subject = "Reviewed résumé 你好 ".repeat(8);
    await expect(executeGoogleWrite(connection, { type: "email_draft", to: "a@example.test", subject, body: "Body" }, id, fetcher)).resolves.toMatchObject({ verified: true });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const words = [...decoded.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)];
    expect(words.length).toBeGreaterThan(1);
    expect(words.every((word) => word[0].length <= 75)).toBe(true);
    expect(words.map((word) => Buffer.from(word[1], "base64").toString("utf8")).join("")).toBe(subject.trim());
  });
  it("rejects a read-back draft with an injected extra recipient or duplicated To header", async () => {
    for (const injected of ["Cc: other@example.test\r\n", "To: other@example.test\r\n"]) {
      let raw = "";
      const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") { raw = JSON.parse(String(init.body)).message.raw; return Response.json({ id: "draft1" }); }
        return Response.json({ id: "draft1", message: { raw: Buffer.from(injected + Buffer.from(raw, "base64url").toString("utf8")).toString("base64url") } });
      });
      await expect(executeGoogleWrite(connection, { type: "email_draft", to: "a@example.test", subject: "Subject", body: "Body" }, id, fetcher)).rejects.toThrow(/read-back/);
    }
  });
});
