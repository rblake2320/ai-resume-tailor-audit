"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { scanResume } from "@/lib/ats";
import type { TailorResult } from "@/lib/schema";
import {
  addHistory,
  clearAllData,
  deleteHistory,
  loadHistory,
  loadProfile,
  saveProfile,
  type HistoryEntry,
} from "@/lib/storage";
import { ResultView } from "@/components/ResultView";
import { Chip, Section, Spinner, ToolButton } from "@/components/ui";

type Phase = "idle" | "working" | "done" | "error";

const noopSubscribe = () => () => {};

export default function Home() {
  // True only after client hydration — lets us read localStorage without SSR mismatch.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  // Profile (saved locally, once)
  const [resume, setResume] = useState(() => loadProfile()?.resume ?? "");
  const [extraInfo, setExtraInfo] = useState(() => loadProfile()?.extraInfo ?? "");
  const [savedSnapshot, setSavedSnapshot] = useState<{ resume: string; extraInfo: string } | null>(
    null,
  );

  // Job
  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [emphasis, setEmphasis] = useState<"balanced" | "technical" | "leadership">("balanced");
  const [fetching, setFetching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");

  // Run
  const [phase, setPhase] = useState<Phase>("idle");
  const [thinking, setThinking] = useState("");
  const [progressChars, setProgressChars] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TailorResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const thinkingRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Debounced autosave of the profile (all setState happens inside the timer callback)
  useEffect(() => {
    const t = setTimeout(() => {
      saveProfile({ resume, extraInfo });
      setSavedSnapshot({ resume, extraInfo });
    }, 600);
    return () => clearTimeout(t);
  }, [resume, extraInfo]);

  const profileSaved =
    savedSnapshot === null ||
    (savedSnapshot.resume === resume && savedSnapshot.extraInfo === extraInfo);

  // Auto-scroll the live analysis feed
  useEffect(() => {
    thinkingRef.current?.scrollTo({ top: thinkingRef.current.scrollHeight });
  }, [thinking]);

  const scan = useMemo(
    () => (resume.length > 100 && jobText.length > 80 ? scanResume(resume, jobText) : null),
    [resume, jobText],
  );

  const uploadResume = useCallback(async (file: File) => {
    setUploading(true);
    setNotice("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-resume", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      setResume(data.text);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, []);

  const fetchJob = useCallback(async () => {
    if (!jobUrl.trim()) return;
    setFetching(true);
    setNotice("");
    try {
      const res = await fetch("/api/fetch-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fetch failed.");
      setJobText(data.text);
      if (data.title && !jobTitle) setJobTitle(String(data.title).slice(0, 160));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Fetch failed.");
    } finally {
      setFetching(false);
    }
  }, [jobUrl, jobTitle]);

  const forge = useCallback(async () => {
    setPhase("working");
    setThinking("");
    setProgressChars(0);
    setError("");
    setResult(null);
    try {
      const fullResume = extraInfo.trim()
        ? `${resume}\n\n--- Additional background the candidate provided (use as honest evidence, do not print verbatim) ---\n${extraInfo}`
        : resume;
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: fullResume, jobDescription: jobText, jobTitle, company, emphasis }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "thinking"; text: string }
            | { type: "progress"; chars: number }
            | { type: "result"; data: TailorResult }
            | { type: "error"; message: string };
          if (event.type === "thinking") setThinking((t) => t + event.text);
          else if (event.type === "progress") setProgressChars(event.chars);
          else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "result") {
            setResult(event.data);
            setHistory(addHistory({ jobTitle, company, result: event.data }));
            setPhase("done");
            finished = true;
          }
        }
      }
      if (!finished) throw new Error("The stream ended unexpectedly. Try again.");
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }, [resume, extraInfo, jobText, jobTitle, company, emphasis]);

  const ready = resume.length >= 200 && jobText.length >= 100 && phase !== "working";
  const slug =
    `${company || "job"}-${jobTitle || "role"}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "tailored";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 md:px-8">
      {/* Masthead */}
      <header className="rise mb-10 border-b border-ink-700 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-brass-400">
              est. one profile · any job
            </p>
            <h1 className="font-display text-5xl font-semibold text-paper md:text-6xl">
              Resume <em className="text-brass-300" style={{ fontVariationSettings: "'SOFT' 100, 'WONK' 1" }}>Foundry</em>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-300">
              Save your career history once. Point it at any job posting. Get an honestly tailored,
              ATS-safe resume and cover letter — with every change accounted for.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <Chip tone="good">🔒 Local-first — your data never leaves this browser</Chip>
            <Chip tone="brass">No fabricated skills, ever</Chip>
            <Chip tone="muted">Powered by Claude Opus 5</Chip>
          </div>
        </div>
      </header>

      {!hydrated ? (
        <main className="py-20 text-center font-mono text-xs text-ink-400">loading your workshop…</main>
      ) : (
      <main className="space-y-6">
        {/* 01 — Profile */}
        <div className="rise" style={{ animationDelay: "80ms" }}>
          <Section
            step="01"
            title="Your profile"
            hint={profileSaved ? "saved locally ✓" : "saving…"}
          >
            <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="resume" className="text-xs text-ink-300">
                    Master resume — paste it, or upload PDF / .txt / .md
                  </label>
                  <label className="cursor-pointer rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 transition hover:border-brass-400/60 hover:text-brass-300">
                    {uploading ? <Spinner /> : "Upload file"}
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,text/plain,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadResume(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <textarea
                  id="resume"
                  value={resume}
                  onChange={(e) => setResume(e.target.value)}
                  placeholder="JANE DOE — Senior Backend Engineer&#10;jane@…&#10;&#10;EXPERIENCE&#10;…paste your full resume here…"
                  className="h-56 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/80 p-3 font-mono text-xs leading-relaxed text-ink-100 outline-none transition focus:border-brass-400/60"
                />
                <p className="mt-1 text-right font-mono text-[10px] text-ink-400">{resume.length.toLocaleString()} chars</p>
              </div>
              <div>
                <label htmlFor="extra" className="mb-2 block text-xs text-ink-300">
                  Everything else — projects, wins, metrics, constraints that never fit on the resume
                </label>
                <textarea
                  id="extra"
                  value={extraInfo}
                  onChange={(e) => setExtraInfo(e.target.value)}
                  placeholder="Side project: built a Discord bot with 4k users…&#10;Cut AWS bill 38% in 2024…&#10;Prefer remote; open to hybrid in Austin…"
                  className="h-56 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/80 p-3 text-xs leading-relaxed text-ink-100 outline-none transition focus:border-brass-400/60"
                />
                <p className="mt-1 text-[10px] leading-snug text-ink-400">
                  Used as honest evidence when tailoring — more material, better results.
                </p>
              </div>
            </div>
          </Section>
        </div>

        {/* 02 — Job */}
        <div className="rise" style={{ animationDelay: "160ms" }}>
          <Section step="02" title="The job" hint="paste a link or the posting text">
            <div className="mb-3 flex flex-wrap gap-2">
              <input
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void fetchJob()}
                placeholder="https://job-boards.greenhouse.io/…  (LinkedIn links often require login — paste the text below instead)"
                className="min-w-64 flex-1 rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-xs text-ink-100 outline-none transition focus:border-brass-400/60"
              />
              <button
                type="button"
                onClick={() => void fetchJob()}
                disabled={fetching || !jobUrl.trim()}
                className="rounded-lg border border-brass-400/50 bg-brass-400/10 px-4 py-2 text-xs font-semibold text-brass-300 transition hover:bg-brass-400/20 disabled:opacity-40"
              >
                {fetching ? <Spinner /> : "Fetch posting"}
              </button>
            </div>
            <textarea
              value={jobText}
              onChange={(e) => setJobText(e.target.value)}
              placeholder="…or paste the full job description here…"
              className="h-40 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/80 p-3 font-mono text-xs leading-relaxed text-ink-100 outline-none transition focus:border-brass-400/60"
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Job title (optional)"
                className="rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-xs text-ink-100 outline-none transition focus:border-brass-400/60"
              />
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Company (optional)"
                className="rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-xs text-ink-100 outline-none transition focus:border-brass-400/60"
              />
              <select
                value={emphasis}
                onChange={(e) => setEmphasis(e.target.value as typeof emphasis)}
                className="rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-xs text-ink-100 outline-none transition focus:border-brass-400/60"
              >
                <option value="balanced">Emphasis: balanced</option>
                <option value="technical">Emphasis: technical depth</option>
                <option value="leadership">Emphasis: leadership</option>
              </select>
            </div>
            {notice && <p className="mt-2 text-xs text-warn">{notice}</p>}
          </Section>
        </div>

        {/* Instant scan */}
        {scan && (
          <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs text-brass-400">instant scan</span>
              <span className="text-sm text-ink-100">
                {scan.matched}/{scan.total} top job keywords in your resume
              </span>
              <span className="font-mono text-xs text-ink-300">({scan.coverage}% coverage — before any AI)</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {scan.keywords.slice(0, 18).map((k) => (
                <Chip key={k.keyword} tone={k.inResume ? "good" : "muted"} title={k.inResume ? "present" : "missing"}>
                  {k.inResume ? "✓ " : "· "}
                  {k.keyword}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-400">
              Deterministic keyword check, computed in your browser — the transparent baseline the AI pass improves on.
            </p>
          </div>
        )}

        {/* 03 — Forge */}
        <div className="rise flex flex-col items-center gap-4 py-2" style={{ animationDelay: "240ms" }}>
          <button
            type="button"
            onClick={() => void forge()}
            disabled={!ready}
            className="group relative rounded-xl border border-brass-400/60 bg-gradient-to-b from-brass-400/25 to-brass-500/10 px-10 py-4 font-display text-xl font-semibold text-brass-300 shadow-[0_8px_30px_rgba(240,180,92,0.15)] transition hover:from-brass-400/35 hover:shadow-[0_8px_40px_rgba(240,180,92,0.28)] disabled:opacity-35 disabled:shadow-none"
          >
            {phase === "working" ? (
              <span className="flex items-center gap-3">
                <Spinner /> Forging…
              </span>
            ) : (
              "Forge my resume →"
            )}
          </button>
          {!ready && phase !== "working" && (
            <p className="font-mono text-[11px] text-ink-400">
              needs: resume ≥ 200 chars {resume.length >= 200 ? "✓" : `(${resume.length})`} · job ≥ 100 chars{" "}
              {jobText.length >= 100 ? "✓" : `(${jobText.length})`}
            </p>
          )}
        </div>

        {/* Live analysis feed */}
        {phase === "working" && (
          <div className="rounded-xl border border-ink-700 bg-ink-950 p-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-brass-400">
              <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-brass-400" />
              live analysis
              {progressChars > 0 && (
                <span className="ml-auto normal-case text-ink-400">
                  drafting documents… {progressChars.toLocaleString()} chars
                </span>
              )}
            </div>
            <div
              ref={thinkingRef}
              className="max-h-52 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-300"
            >
              {thinking || "Reading your resume and the posting…"}
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
            {error}
          </div>
        )}

        {/* Result */}
        <div ref={resultRef}>
          {result && (
            <div className="space-y-4">
              <h2 className="font-display pt-4 text-2xl font-semibold text-paper">
                The forged result{jobTitle && <span className="text-ink-300"> — {jobTitle}</span>}
                {company && <span className="text-brass-300"> @ {company}</span>}
              </h2>
              <ResultView result={result} slug={slug} />
            </div>
          )}
        </div>

        {/* History */}
        {history.length > 0 && (
          <section className="mt-10 border-t border-ink-700 pt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-paper">
                Past runs <span className="text-ink-400">(stored only in this browser)</span>
              </h2>
              <ToolButton
                onClick={() => {
                  if (confirm("Delete your saved profile and all history from this browser?")) {
                    clearAllData();
                    setHistory([]);
                    setResume("");
                    setExtraInfo("");
                  }
                }}
              >
                Erase all my data
              </ToolButton>
            </div>
            <ul className="grid gap-2 md:grid-cols-2">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900/70 px-4 py-3"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setResult(h.result);
                      setJobTitle(h.jobTitle);
                      setCompany(h.company);
                      setPhase("done");
                      setTimeout(
                        () => resultRef.current?.scrollIntoView({ behavior: "smooth" }),
                        50,
                      );
                    }}
                  >
                    <span className="block truncate text-sm text-ink-100">
                      {h.jobTitle || "Untitled role"}
                      {h.company && <span className="text-brass-300"> @ {h.company}</span>}
                    </span>
                    <span className="font-mono text-[10px] text-ink-400">
                      {new Date(h.createdAt).toLocaleString()} · match {h.result.match_score_before} →{" "}
                      {h.result.match_score_after}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistory(deleteHistory(h.id))}
                    className="text-xs text-ink-400 transition hover:text-bad"
                    aria-label="Delete entry"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      )}

      <footer className="mt-16 border-t border-ink-700 pt-6 text-center font-mono text-[11px] leading-relaxed text-ink-400">
        Honest tailoring only — nothing is invented, and keywords the model can’t evidence are listed, not faked.
        <br />
        Your profile and history live in this browser’s localStorage. The server keeps nothing.
      </footer>
    </div>
  );
}
