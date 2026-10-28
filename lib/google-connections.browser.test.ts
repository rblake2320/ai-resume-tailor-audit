// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connections } from "../components/Connections";
import { JobInbox } from "../components/JobInbox";
import { loadJobInbox } from "./storage";

let root: Root;
function button(text: string) { const found = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text); if (!found) throw new Error(`Missing ${text}`); return found; }
async function click(text: string) { await act(async () => button(text).dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
async function fill(label: string, value: string) {
  const node = [...document.querySelectorAll("label")].find((item) => item.textContent?.startsWith(label))?.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement;
  if (!node) throw new Error(`Missing input ${label}`);
  await act(async () => { const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("crypto", webcrypto); localStorage.clear(); const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Google workflow browser receiving behavior", () => {
  it("reads only after a click and imports reviewed alert into visible Job Inbox and durable browser storage", async () => {
    const text = "Synthetic job description: " + "engineering experience required. ".repeat(10);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/status")) return Response.json({ connected: true, configured: true, features: ["email_alerts"] });
      expect(JSON.parse(String(init?.body))).toMatchObject({ operation: "read_alerts" });
      return Response.json({ alerts: [{ id: "alert1", subject: "Quality engineer", from: "alerts@example.test", text }] });
    });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(createElement(Fragment, null, createElement(Connections), createElement(JobInbox, { current: { company: "", title: "", description: "" }, onSelect: vi.fn() }))));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await click("Read up to 10 matching alerts");
    await fill("Employer", "Synthetic Employer");
    await click("Import reviewed alert to Job Inbox");
    expect(loadJobInbox()).toHaveLength(1);
    expect(loadJobInbox()[0]).toMatchObject({ company: "Synthetic Employer", title: "Quality engineer", description: text.trim(), source: "email", sourceId: "gmail:alert1" });
    expect(document.querySelector('[aria-labelledby="job-inbox-heading"]')?.textContent).toContain("Synthetic Employer");
    await click("Import reviewed alert to Job Inbox");
    expect(loadJobInbox()).toHaveLength(1);
  });
  it("requires separate review and approve clicks before creating an unsent Gmail draft", async () => {
    const operations: string[] = [];
    const id = "78e5f75a-885e-45ba-a25e-d35c7c75a125";
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/status")) return Response.json({ connected: true, configured: true, features: ["email_drafts"] });
      const input = JSON.parse(String(init?.body)); operations.push(input.operation);
      if (input.operation === "review") return Response.json({ review: { id, action: input.action, expiresAt: Date.now() + 300000 } });
      expect(input).toEqual({ operation: "approve", approvalId: id });
      return Response.json({ receipt: { type: "email_draft", providerId: "draft1", verified: true, sent: false, link: "https://mail.google.com/mail/u/0/#drafts" } });
    });
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(createElement(Connections)));
    await fill("Recipient", "employer@example.test"); await fill("Subject", "Synthetic follow-up"); await fill("Message", "Reviewed synthetic content.");
    expect(operations).toEqual([]);
    await click("Review draft");
    expect(operations).toEqual(["review"]);
    expect(document.body.textContent).toContain("Reviewed synthetic content.");
    await click("Approve & create unsent draft");
    expect(operations).toEqual(["review", "approve"]);
    expect(document.body.textContent).toContain("Verified Google receipt: draft1");
  });
});
