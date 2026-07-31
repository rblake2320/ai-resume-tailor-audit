// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { deleteCareerLedgerMock } = vi.hoisted(() => ({ deleteCareerLedgerMock: vi.fn(async () => undefined) }));
vi.mock("@/lib/career-vault", () => ({ deleteCareerLedger: deleteCareerLedgerMock }));

vi.mock("@/components/ResultView", () => ({ ResultView: () => null }));
vi.mock("@/components/SpeechControls", () => ({ DictationButton: () => null }));
vi.mock("@/components/JobInbox", () => ({ JobInbox: () => null }));
vi.mock("@/components/ApplicationTracker", () => ({ ApplicationTracker: () => null }));
vi.mock("@/components/CareerLedger", () => ({ CareerLedger: () => null }));
vi.mock("@/components/Connections", () => ({ Connections: () => null }));
vi.mock("@/components/SensitiveAttestationBoundary", () => ({ SensitiveAttestationBoundary: () => null }));
vi.mock("@/components/ui", async () => {
  const ReactModule = await import("react");
  return {
    Chip: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement("span", null, children),
    Section: ({ children, title }: { children?: React.ReactNode; title?: string }) =>
      ReactModule.createElement("section", null, ReactModule.createElement("h2", null, title), children),
    Spinner: () => ReactModule.createElement("span", null, "loading"),
    ToolButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      ReactModule.createElement("button", { type: "button", ...props }, children),
  };
});

import Home from "@/app/page";

const resume = `Jane Doe\nJane@example.com\n${"Experienced engineer delivering reliable systems. ".repeat(6)}`;
const job = "Build and operate reliable systems with testing, security, documentation, collaboration, and customer focus. ".repeat(2);

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return match;
}

describe("real browser outbound PII flow", () => {
  let root: Root;
  let requests: Array<Record<string, unknown>>;

  beforeEach(async () => {
    localStorage.clear();
    requests = [];
    deleteCareerLedgerMock.mockReset();
    deleteCareerLedgerMock.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "result", data: {} })}\n`));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }));
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(React.createElement(Home)); });
    await act(async () => {
      setValue(document.querySelector("#candidate-name") as HTMLInputElement, "Jane Doe");
      setValue(document.querySelector("#resume") as HTMLTextAreaElement, resume);
      setValue(document.querySelector("#job-description") as HTMLTextAreaElement, job);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("protect mode sends the outbound request without the explicit name or contact data", async () => {
    await act(async () => button("Forge my resume").click());
    expect(requests).toHaveLength(1);
    const outbound = String(requests[0].resume);
    expect(outbound).not.toMatch(/Jane Doe|Jane@example\.com/i);
    expect(outbound).toMatch(/\[\[RF_[a-f0-9]{32}_CANDIDATE_NAME_1\]\]/);
  });

  it("review mode sends nothing until the user chooses protected or exact transmission", async () => {
    await act(async () => setValue(
      document.querySelector('[aria-label="Personal information protection mode"]') as HTMLSelectElement,
      "review",
    ));
    await act(async () => button("Forge my resume").click());
    expect(requests).toHaveLength(0);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => button("Send protected copy").click());
    expect(requests).toHaveLength(1);
    expect(String(requests[0].resume)).not.toMatch(/Jane Doe|Jane@example\.com/i);
  });

  it("review mode sends exact text only after the explicit one-time choice", async () => {
    await act(async () => setValue(
      document.querySelector('[aria-label="Personal information protection mode"]') as HTMLSelectElement,
      "review",
    ));
    await act(async () => button("Forge my resume").click());
    await act(async () => button("Send exact text once").click());
    expect(requests).toHaveLength(1);
    expect(String(requests[0].resume)).toContain("Jane Doe");
    expect(String(requests[0].resume)).toContain("Jane@example.com");
  });

  it("clears visible PII even when encrypted-vault deletion reports a failure", async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    localStorage.clear();
    localStorage.setItem("art:profile", JSON.stringify({ candidateName: "Jane Doe", resume, extraInfo: "private", updatedAt: 1 }));
    localStorage.setItem("art:history", JSON.stringify([{
      id: "history-1", createdAt: 1, jobTitle: "Engineer", company: "Example",
      result: {
        match_score_before: 1, match_score_after: 2, score_rationale: "Evidence",
        changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [],
        requirement_evidence: [], ats_checks: [], tailored_resume_markdown: "Resume", cover_letter_markdown: "Letter",
      },
    }]));
    deleteCareerLedgerMock.mockRejectedValueOnce(new Error("vault unavailable"));
    vi.stubGlobal("confirm", vi.fn(() => true));
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(React.createElement(Home)); });
    expect((document.querySelector("#candidate-name") as HTMLInputElement).value).toBe("Jane Doe");

    await act(async () => button("Erase all my data").click());
    expect((document.querySelector("#candidate-name") as HTMLInputElement).value).toBe("");
    expect((document.querySelector("#resume") as HTMLTextAreaElement).value).toBe("");
    expect(localStorage.getItem("art:profile")).toBeNull();
    expect(document.body.textContent).toContain("Browser storage failed while erasing the encrypted career ledger");
  });
});
