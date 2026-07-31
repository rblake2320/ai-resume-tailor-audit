"use client";

import { useState } from "react";
import type { TailorResult } from "@/lib/schema";

const LABELS: Record<string, string> = {
  proven: "Proven",
  partially_supported: "Partially supported",
  unsupported: "Unsupported",
  needs_clarification: "Needs clarification",
  intentionally_omitted: "Intentionally omitted",
};

export function EvidenceWorkspace({ items }: { items: TailorResult["requirement_evidence"] }) {
  const [selected, setSelected] = useState(items[0]?.id ?? "");
  if (items.length === 0) return null;
  const active = items.find((item) => item.id === selected) ?? items[0];
  const panel = "rounded-xl border border-ink-700 bg-ink-900/70 p-4";
  return <section aria-labelledby="evidence-workspace-heading">
    <div className="mb-3">
      <h3 id="evidence-workspace-heading" className="text-xs font-semibold uppercase tracking-wider text-ink-300">Requirement → evidence → tailored text</h3>
      <p className="mt-1 text-[11px] text-ink-400">Select a requirement to inspect exactly why the documents say what they say.</p>
    </div>
    <div className="grid gap-3 lg:grid-cols-3">
      <div className={panel} aria-label="Job requirements">
        <h4 className="mb-2 text-xs font-semibold text-brass-300">Job requirement</h4>
        <div className="space-y-2">{items.map((item) => <button key={item.id} type="button" aria-pressed={item.id === active.id} onClick={() => setSelected(item.id)} className={`w-full rounded-lg border p-2 text-left text-xs ${item.id === active.id ? "border-brass-400 bg-brass-400/10" : "border-ink-700 hover:border-ink-500"}`}>
          <span className="block text-ink-100">{item.requirement}</span>
          <span className="mt-1 block font-mono text-[10px] text-ink-400">{item.category} · {LABELS[item.state]}</span>
        </button>)}</div>
      </div>
      <div className={panel} aria-label="Resume evidence">
        <h4 className="mb-2 text-xs font-semibold text-brass-300">Your evidence</h4>
        {active.evidence.length ? <ul className="space-y-2 text-xs text-ink-100">{active.evidence.map((entry, index) => <li key={index} className="rounded-lg bg-ink-950 p-2">{entry}</li>)}</ul> : <p className="text-xs text-bad">No supporting résumé evidence.</p>}
        {active.recommendation && <p className="mt-3 text-xs leading-relaxed text-warn">Next step: {active.recommendation}</p>}
      </div>
      <div className={panel} aria-label="Tailored application text">
        <h4 className="mb-2 text-xs font-semibold text-brass-300">Tailored application</h4>
        {active.tailoredText.length ? <ul className="space-y-2 text-xs text-ink-100">{active.tailoredText.map((entry, index) => <li key={index} className="rounded-lg bg-ink-950 p-2">{entry}</li>)}</ul> : <p className="text-xs text-ink-400">Nothing was added for this requirement.</p>}
      </div>
    </div>
  </section>;
}
