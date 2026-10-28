// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficialSubmission } from "../components/OfficialSubmission";
import { createApplicationPacket, createApplicationRecord, type ApplicationRecord } from "./applications";
import { createJobSnapshot } from "./job-inbox";
import { browserSubmissionPreview } from "./submission-preview";
import { issueSubmissionApproval } from "./submission-connectors";
import type { TailorResult } from "./schema";

let root: Root;
let record: ApplicationRecord;
const secret = "synthetic-human-secret-for-browser-test";
function button(text: string) { const found = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === text); if (!found) throw new Error(`Missing ${text}: ${document.body.textContent}`); return found; }
async function click(text: string) { await act(async () => button(text).dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
async function fill(label: string, value: string) {
  const node = [...document.querySelectorAll("label")].find((item) => item.textContent?.startsWith(label))?.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement;
  await act(async () => { const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal("crypto", webcrypto); localStorage.clear();
  const jobSnapshot = await createJobSnapshot({ title: "Engineer", company: "Synthetic Employer", description: "Synthetic reviewed position: " + "software engineering evidence. ".repeat(8) });
  const result: TailorResult = { match_score_before: 40, match_score_after: 60, score_rationale: "Fixture", changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [], requirement_evidence: [], ats_checks: [], tailored_resume_markdown: "# Frozen rÃ©sumÃ©", cover_letter_markdown: "Frozen cover letter." };
  record = createApplicationRecord(await createApplicationPacket({ jobSnapshot, profile: { resume: "Candidate evidence", extraInfo: "" }, result }));
  record.notes = ["PRIVATE TRACKER NOTE"]; record.contacts = [{ name: "PRIVATE RECRUITER", role: "recruiter", email: "private@example.test" }]; record.packetHistory = [structuredClone(record.packet)];
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });

async function prepare() {
  await act(async () => root.render(createElement(OfficialSubmission, { record, onClose: vi.fn() })));
  await fill("Authorized board/site", "synthetic"); await fill("Job/posting identifier", "123"); await fill("Human approval secret", secret);
  await click("Build exact submission preview");
  for (let tick = 0; tick < 100 && button("Build exact submission preview").disabled; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

describe("official submission independent browser boundaries", () => {
  it("transmits only current packet for preview, persists no secret and requires reviewed consent before single execute", async () => {
    const operations: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const operation = String(url).split("/").pop()!; operations.push(operation);
      const input = JSON.parse(String(init?.body));
      if (operation === "preview") {
        expect(Object.keys(input.record).sort()).toEqual(["packet", "state"]);
        expect(String(init?.body)).not.toContain("PRIVATE TRACKER NOTE"); expect(String(init?.body)).not.toContain("private@example.test");
        return Response.json(await browserSubmissionPreview(input));
      }
      if (operation === "approve") return Response.json(issueSubmissionApproval(input, secret));
      return Response.json({ accepted: true, status: 202, provider: "greenhouse", applicationId: record.packet.id });
    });
    vi.stubGlobal("fetch", fetcher); await prepare();
    expect(operations).toEqual(["preview"]); expect(button("Approve and submit once").disabled).toBe(true);
    const consent = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => consent.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const submit = button("Approve and submit once");
    await act(async () => { submit.dispatchEvent(new MouseEvent("click", { bubbles: true })); submit.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(operations).toEqual(["preview", "approve", "execute"]);
    expect(document.body.textContent).toContain("Provider accepted the request (HTTP 202)");
    expect(localStorage.length).toBe(0);
    expect(document.body.textContent).not.toContain(secret);
  });
  it("contains malformed preview responses without exposing an approve control", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ fields: {} })));
    await prepare();
    expect(document.body.textContent).toContain("Preview response did not match");
    expect([...document.querySelectorAll("button")].some((node) => node.textContent === "Approve and submit once")).toBe(false);
  });
  it("does not report acceptance for a malformed HTTP 200 execution response", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body));
      if (String(url).endsWith("/preview")) return Response.json(await browserSubmissionPreview(input));
      if (String(url).endsWith("/approve")) return Response.json(issueSubmissionApproval(input, secret));
      return Response.json({ status: 200 });
    }));
    await prepare();
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await click("Approve and submit once");
    expect(document.body.textContent).toContain("valid acceptance receipt");
    expect(document.body.textContent).not.toContain("Provider accepted the request");
  });
});
