"use client";

import { forwardRef, useState } from "react";

export function Section({
  step,
  title,
  hint,
  children,
}: {
  step: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-5 shadow-[0_2px_20px_rgba(0,0,0,0.25)]">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-xs text-brass-400">{step}</span>
        <h2 className="text-sm font-semibold tracking-wide text-paper">{title}</h2>
        {hint && <span className="text-xs text-ink-400">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function ScoreDial({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const clamped = Math.max(0, Math.min(100, value));
  const hue = clamped < 40 ? "var(--color-bad)" : clamped < 70 ? "var(--color-warn)" : "var(--color-good)";
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 84 84" className="h-24 w-24 -rotate-90">
          <circle cx="42" cy="42" r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="7" />
          <circle
            cx="42"
            cy="42"
            r={r}
            fill="none"
            stroke={accent ? "var(--color-brass-400)" : hue}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * c} ${c}`}
            className="transition-all duration-700"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-xl font-bold text-paper">
          {clamped}
        </span>
      </div>
      <span className="text-xs text-ink-300">{label}</span>
    </div>
  );
}

export function Chip({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone: "good" | "brass" | "muted" | "bad";
  title?: string;
}) {
  const tones = {
    good: "border-good/40 bg-good/10 text-good",
    brass: "border-brass-400/40 bg-brass-400/10 text-brass-300",
    muted: "border-ink-700 bg-ink-800 text-ink-300",
    bad: "border-bad/40 bg-bad/10 text-bad",
  } as const;
  return (
    <span
      title={title}
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 transition hover:border-brass-400/60 hover:text-brass-300"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

export const ToolButton = forwardRef<HTMLButtonElement, {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}>(function ToolButton({
  onClick,
  children,
  disabled,
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 transition hover:border-brass-400/60 hover:text-brass-300 disabled:opacity-40"
    >
      {children}
    </button>
  );
});

export function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-400 border-t-brass-400 align-middle" />
  );
}

export function downloadText(content: string, filename: string, mime = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
