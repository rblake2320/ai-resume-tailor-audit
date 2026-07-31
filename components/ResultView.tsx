"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import type { TailorResult } from "@/lib/schema";
import { mdToAtsText, mdToHtml } from "@/lib/markdown";
import { downloadDocx } from "@/lib/docx-export";
import { Chip, CopyButton, ScoreDial, ToolButton, downloadText } from "./ui";
import { ReadAloudControls } from "./SpeechControls";
import { EvidenceWorkspace } from "./EvidenceWorkspace";

const KIND_LABEL: Record<TailorResult["changes"][number]["kind"], string> = {
  reworded: "Reworded",
  reordered: "Reordered",
  removed: "Removed",
  emphasized: "Emphasized",
};

const KIND_TONE: Record<string, "brass" | "muted" | "bad" | "good"> = {
  reworded: "brass",
  reordered: "muted",
  removed: "bad",
  emphasized: "good",
};

type Tab = "resume" | "ats" | "cover";

export function ResultView({
  result,
  slug,
  onResultChange,
}: {
  result: TailorResult;
  slug: string;
  onResultChange?: (result: TailorResult) => void;
}) {
  const [tab, setTab] = useState<Tab>("resume");
  const [editing, setEditing] = useState(false);
  const resumeHtml = useMemo(() => mdToHtml(result.tailored_resume_markdown), [result]);
  const coverHtml = useMemo(() => mdToHtml(result.cover_letter_markdown), [result]);
  const atsText = useMemo(() => mdToAtsText(result.tailored_resume_markdown), [result]);

  const activeMd = tab === "cover" ? result.cover_letter_markdown : result.tailored_resume_markdown;
  const activeName = tab === "cover" ? `cover-letter-${slug}` : `resume-${slug}`;
  const tabs: Tab[] = ["resume", "ats", "cover"];
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = tabs.indexOf(current);
    const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length]
        : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1)! : null;
    if (!next) return;
    event.preventDefault(); setTab(next);
    document.getElementById(`result-tab-${next}`)?.focus();
  }

  return (
    <div className="space-y-6">
      {/* Scores */}
      <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-5">
        <div className="flex flex-wrap items-center justify-center gap-10">
          <ScoreDial label="Match before" value={result.match_score_before} />
          <span className="text-2xl text-ink-400">→</span>
          <ScoreDial label="Match after" value={result.match_score_after} accent />
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-relaxed text-ink-300">
          {result.score_rationale}
        </p>
      </div>

      <EvidenceWorkspace items={result.requirement_evidence ?? []} />

      {/* Keywords */}
      <div className="grid gap-4 md:grid-cols-3">
        <KeywordCard title="Already matched" tone="good" items={result.keywords.matched} />
        <KeywordCard title="Honestly added" tone="brass" items={result.keywords.added} />
        <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
            Not added — no evidence
          </h3>
          {result.keywords.not_added.length === 0 ? (
            <p className="text-xs text-ink-400">Everything the job asks for has evidence in your history.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {result.keywords.not_added.map((k) => (
                <Chip key={k.keyword} tone="bad" title={k.reason}>
                  {k.keyword}
                </Chip>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] leading-snug text-ink-400">
            The honesty guarantee: keywords are never faked in. Hover a chip for why it was left out.
          </p>
        </div>
      </div>

      {/* Change diff + gaps + ATS checks */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">
            What changed ({result.changes.length})
          </h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1 text-sm">
            {result.changes.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 pt-0.5">
                  <Chip tone={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</Chip>
                </span>
                <span className="leading-snug text-ink-100">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">
              Gap analysis — before you apply
            </h3>
            {result.gap_analysis.length === 0 ? (
              <p className="text-xs text-ink-400">No material gaps found.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {result.gap_analysis.map((g, i) => (
                  <li key={i} className="leading-snug">
                    <span className="text-warn">{g.gap}</span>
                    <span className="text-ink-300"> — {g.advice}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-300">ATS checks</h3>
            <ul className="space-y-1.5 text-sm">
              {result.ats_checks.map((c, i) => (
                <li key={i} className="flex items-start gap-2 leading-snug">
                  <span className={c.status === "pass" ? "text-good" : "text-warn"}>
                    {c.status === "pass" ? "✓" : "⚠"}
                  </span>
                  <span>
                    <span className="text-ink-100">{c.check}</span>
                    <span className="text-ink-400"> — {c.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Documents */}
      <div className="rounded-xl border border-ink-700 bg-ink-900/70">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 px-4 py-3">
          <div role="tablist" aria-label="Generated document views" className="flex flex-wrap gap-2">
          {(
            [
              ["resume", "Tailored resume"],
              ["ats", "What the ATS sees"],
              ["cover", "Cover letter"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`result-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="result-document-panel"
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              onKeyDown={(event) => moveTab(event, t)}
              className={`rounded-md px-3 py-1.5 text-xs transition ${
                tab === t
                  ? "bg-brass-400/15 text-brass-300 border border-brass-400/40"
                  : "border border-transparent text-ink-300 hover:text-ink-100"
              }`}
            >
              {label}
            </button>
          ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <ReadAloudControls text={tab === "ats" ? atsText : activeMd} />
            {tab !== "ats" && (
              <ToolButton onClick={() => setEditing((value) => !value)}>
                {editing ? "Preview" : "Edit manually"}
              </ToolButton>
            )}
            <CopyButton text={tab === "ats" ? atsText : activeMd} />
            <ToolButton onClick={() => downloadDocx(activeMd, `${activeName}.docx`)}>.docx</ToolButton>
            <ToolButton onClick={() => downloadText(activeMd, `${activeName}.md`, "text/markdown")}>
              .md
            </ToolButton>
            <ToolButton onClick={() => downloadText(mdToAtsText(activeMd), `${activeName}.txt`)}>
              .txt
            </ToolButton>
            <ToolButton onClick={() => window.print()}>Print / PDF</ToolButton>
          </div>
        </div>
        <div
          id="result-document-panel"
          role="tabpanel"
          aria-labelledby={`result-tab-${tab}`}
          className="p-6 md:p-8"
        >
          {editing && tab !== "ats" ? (
            <div>
              <label htmlFor="manual-document-editor" className="mb-2 block text-xs text-ink-300">
                Manual edits are saved into the active session and future save points.
              </label>
              <textarea
                id="manual-document-editor"
                aria-label={tab === "cover" ? "Edit cover letter manually" : "Edit tailored resume manually"}
                value={activeMd}
                onChange={(event) =>
                  onResultChange?.({
                    ...result,
                    ...(tab === "cover"
                      ? { cover_letter_markdown: event.target.value }
                      : { tailored_resume_markdown: event.target.value }),
                  })
                }
                className="h-[38rem] w-full resize-y rounded-lg border border-ink-700 bg-ink-950 p-5 font-mono text-xs leading-relaxed text-ink-100 outline-none focus:border-brass-400/60"
              />
            </div>
          ) : tab === "ats" ? (
            <div>
              <p className="mb-3 font-mono text-xs text-ink-400">
                ── raw text an ATS parser extracts — if it reads cleanly here, it reads cleanly in
                Workday, Greenhouse, Lever, and iCIMS ──
              </p>
              <pre className="whitespace-pre-wrap rounded-md border border-ink-700 bg-ink-950 p-5 font-mono text-xs leading-relaxed text-ink-100">
                {atsText}
              </pre>
            </div>
          ) : (
            <div className="sheet mx-auto max-w-3xl p-8 md:p-12">
              <div
                className="md"
                dangerouslySetInnerHTML={{ __html: tab === "cover" ? coverHtml : resumeHtml }}
              />
            </div>
          )}
        </div>
        <div className="print-document" data-print-area data-print-kind={tab} aria-hidden="true">
          {tab === "ats" ? (
            <pre>{atsText}</pre>
          ) : (
            <div
              className="md"
              dangerouslySetInnerHTML={{ __html: tab === "cover" ? coverHtml : resumeHtml }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function KeywordCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "good" | "brass";
  items: string[];
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-ink-400">None.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((k) => (
            <Chip key={k} tone={tone}>
              {k}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
