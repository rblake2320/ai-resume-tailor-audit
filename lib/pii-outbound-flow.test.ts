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

  it("Exact mode directly sends the exact text without opening review", async () => {
    await act(async () => setValue(
      document.querySelector('[aria-label="Personal information protection mode"]') as HTMLSelectElement,
      "exact",
    ));
    await act(async () => button("Forge my resume").click());
    expect(requests).toHaveLength(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(String(requests[0].resume)).toContain("Jane Doe");
    expect(String(requests[0].resume)).toContain("Jane@example.com");
  });

  it("discards an in-flight result when a bound input changes", async () => {
    let release!: () => void;
    const responseReady = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      await responseReady;
      const result = {
        match_score_before: 1, match_score_after: 2, score_rationale: "Stale result",
        changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [],
        requirement_evidence: [], ats_checks: [], tailored_resume_markdown: "Stale resume", cover_letter_markdown: "Stale letter",
      };
      const stream = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: "result", data: result })}\n`));
        controller.close();
      } });
      return new Response(stream, { status: 200 });
    });

    await act(async () => { button("Forge my resume").click(); });
    await act(async () => setValue(document.querySelector("#resume") as HTMLTextAreaElement, `${resume} changed`));
    await act(async () => { release(); await responseReady; });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(document.body.textContent).not.toContain("Stale resume");
    expect(JSON.parse(localStorage.getItem("art:history") ?? "[]")).toEqual([]);
    expect(document.body.textContent).toContain("Inputs changed");
  });

  it("makes erase-all reachable when a profile exists without history", async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    localStorage.clear();
    localStorage.setItem("art:profile", JSON.stringify({ candidateName: "Jane Doe", resume, extraInfo: "private", updatedAt: 1 }));
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => { root.render(React.createElement(Home)); });
    expect(button("Erase all my data")).toBeInstanceOf(HTMLButtonElement);
  });

  it("focuses and contains the review dialog, cancels with Escape, and restores Forge focus", async () => {
    await act(async () => setValue(
      document.querySelector('[aria-label="Personal information protection mode"]') as HTMLSelectElement,
      "review",
    ));
    const forge = button("Forge my resume");
    forge.focus();
    await act(async () => forge.click());
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    const protectedButton = button("Send protected copy");
    const cancelButton = button("Cancel");
    expect(document.activeElement).toBe(protectedButton);
    expect(Array.from(dialog.parentElement?.children ?? []).filter((node) => node !== dialog).every((node) => (node as HTMLElement).inert)).toBe(true);

    cancelButton.focus();
    cancelButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(protectedButton);
    protectedButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(cancelButton);

    await act(async () => protectedButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(forge);
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
