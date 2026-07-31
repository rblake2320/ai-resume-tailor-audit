// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultView } from "../components/ResultView";
import type { TailorResult } from "./schema";

const initial: TailorResult = {
  match_score_before: 50, match_score_after: 75, score_rationale: "Evidence-aligned tailoring.",
  changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [], requirement_evidence: [], ats_checks: [],
  tailored_resume_markdown: "# JANE DOE\n\n## EXPERIENCE\n- Built reliable systems.",
  cover_letter_markdown: "# Cover letter\n\nDear Hiring Manager,\n\nI built reliable systems.",
};

function Harness() {
  const [result, setResult] = useState(initial);
  return createElement(ResultView, { result, slug: "quality-engineer", onResultChange: setResult });
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("generated document browser behavior", () => {
  let root: Root;
  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel: vi.fn(), speak: vi.fn(), pause: vi.fn(), resume: vi.fn() } });
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });

  it("prints the active resume even while the manual editor is open", async () => {
    await click(button("Edit manually"));
    const editor = document.querySelector<HTMLTextAreaElement>("#manual-document-editor")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(editor, "# JANE DOE\n\n## EXPERIENCE\n- Edited approved content.");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const printable = document.querySelector<HTMLElement>("[data-print-area]")!;
    expect(printable.dataset.printKind).toBe("resume");
    expect(printable.textContent).toContain("Edited approved content.");
  });

  it("prints ATS text and cover-letter content instead of a blank sheet", async () => {
    await click(button("What the ATS sees"));
    let printable = document.querySelector<HTMLElement>("[data-print-area]")!;
    expect(printable.dataset.printKind).toBe("ats");
    expect(printable.textContent).toContain("Built reliable systems.");
    await click(button("Cover letter"));
    printable = document.querySelector<HTMLElement>("[data-print-area]")!;
    expect(printable.dataset.printKind).toBe("cover");
    expect(printable.textContent).toContain("Dear Hiring Manager");
  });

  it("supports roving tab focus and announces result completion", async () => {
    const resume = button("Tailored resume"); resume.focus();
    await act(async () => resume.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const ats = button("What the ATS sees");
    expect(document.activeElement).toBe(ats);
    expect(ats.getAttribute("aria-selected")).toBe("true");
    expect(ats.tabIndex).toBe(0);
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(ats.id);
    const status = document.querySelector('[role="status"][aria-live="polite"]');
    expect(status?.textContent).toContain("Tailored documents are ready");
  });
});
