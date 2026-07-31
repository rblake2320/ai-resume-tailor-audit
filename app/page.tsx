"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { scanResume } from "@/lib/ats";
import { protectPii, restorePii, type PiiMatch, type PrivacyMode } from "@/lib/pii";
import type { TailorResult } from "@/lib/schema";
import {
  addHistory,
  addSavePoint,
  clearAllData,
  deleteHistory,
  deleteSavePoint,
  loadHistory,
  loadProfile,
  loadSession,
  loadSavePoints,
  saveProfile,
  saveSession,
  type HistoryEntry,
  type SavePoint,
} from "@/lib/storage";
import { ResultView } from "@/components/ResultView";
import { Chip, Section, Spinner, ToolButton } from "@/components/ui";
import { DictationButton } from "@/components/SpeechControls";
import { JobInbox } from "@/components/JobInbox";
import { ApplicationTracker } from "@/components/ApplicationTracker";
import { CareerLedger } from "@/components/CareerLedger";
import { CareerPathPlanner } from "@/components/CareerPathPlanner";
import { Connections } from "@/components/Connections";
import { SensitiveAttestationBoundary } from "@/components/SensitiveAttestationBoundary";
import { SiteNav } from "@/components/SiteNav";

type Phase = "idle" | "working" | "done" | "error";

const noopSubscribe = () => () => {};
const GENERATION_TIMEOUT_MS = 180_000;

function validJobUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function Home() {
  // True only after client hydration — lets us read localStorage without SSR mismatch.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  // Profile (saved locally, once)
  const [candidateName, setCandidateName] = useState(() => loadProfile()?.candidateName ?? "");
  const [resume, setResume] = useState(() => loadProfile()?.resume ?? "");
  const [extraInfo, setExtraInfo] = useState(() => loadProfile()?.extraInfo ?? "");
  const [savedSnapshot, setSavedSnapshot] = useState<{ candidateName: string; resume: string; extraInfo: string } | null>(
    null,
  );

  // Job (restored from the active session so a reload keeps the current form)
  const [jobUrl, setJobUrl] = useState(() => loadSession()?.jobUrl ?? "");
  const [jobText, setJobText] = useState(() => loadSession()?.jobText ?? "");
  const [jobTitle, setJobTitle] = useState(() => loadSession()?.jobTitle ?? "");
  const [company, setCompany] = useState(() => loadSession()?.company ?? "");
  const [emphasis, setEmphasis] = useState<"balanced" | "technical" | "leadership">(
    () => loadSession()?.emphasis ?? "balanced",
  );
  const [fetching, setFetching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [jobUrlError, setJobUrlError] = useState("");
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>(
    () => loadSession()?.privacyMode ?? "protect",
  );
  const [pendingPii, setPendingPii] = useState<PiiMatch[]>([]);

  // Run (the last generated result is restored too, so a reload keeps it open)
  const [phase, setPhase] = useState<Phase>(() => (loadSession()?.result ? "done" : "idle"));
  const [thinking, setThinking] = useState("");
  const [progressChars, setProgressChars] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TailorResult | null>(() => loadSession()?.result ?? null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [savePoints, setSavePoints] = useState<SavePoint[]>(() => loadSavePoints());
  const thinkingRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const forgeButtonRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const reviewDialogRef = useRef<HTMLDivElement>(null);
  const protectedChoiceRef = useRef<HTMLButtonElement>(null);
  const restoreForgeFocusRef = useRef(false);
  const generationAbortRef = useRef<AbortController | null>(null);
  const activeGenerationRef = useRef(0);
  const cancelReasonRef = useRef<"cancelled" | "timeout" | null>(null);
  const reportPersistenceFailure = useCallback((failure: unknown) => {
    setNotice(failure instanceof Error ? failure.message : "Browser storage failed. Your latest changes may not survive a reload.");
  }, []);

  useEffect(() => {
    if (pendingPii.length === 0 && phase !== "working" && restoreForgeFocusRef.current) {
      restoreForgeFocusRef.current = false;
      forgeButtonRef.current?.focus();
    }
  }, [pendingPii, phase]);

  const closePiiReview = useCallback(() => {
    restoreForgeFocusRef.current = true;
    setPendingPii([]);
  }, []);

  useEffect(() => {
    if (pendingPii.length === 0) return;
    const dialog = reviewDialogRef.current;
    const container = dialog?.parentElement;
    const page = pageRef.current;
    if (!dialog || !container || !page) return;
    const siblings = [...new Set([
      ...Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== dialog),
      ...Array.from(page.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !child.contains(dialog)),
    ])];
    const previous = siblings.map((element) => ({ element, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") }));
    for (const element of siblings) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    protectedChoiceRef.current?.focus();
    return () => {
      for (const { element, inert, ariaHidden } of previous) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [pendingPii]);

  const invalidateResult = useCallback(() => {
    const hadActiveGeneration = generationAbortRef.current !== null;
    activeGenerationRef.current += 1;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    if (!result && !hadActiveGeneration) return;
    setResult(null);
    setPhase("idle");
    setNotice("Inputs changed — the previous generated result remains in Past runs, but is no longer active.");
  }, [result]);

  // Persist the active session (job form + current result) so a reload restores it.
  useEffect(() => {
    try { saveSession({ jobText, jobUrl, jobTitle, company, emphasis, privacyMode, result }); }
    catch (failure) { queueMicrotask(() => reportPersistenceFailure(failure)); }
  }, [jobText, jobUrl, jobTitle, company, emphasis, privacyMode, result, reportPersistenceFailure]);

  // Keep a bounded recovery trail after the user pauses. Identical states are
  // deduplicated, so typing does not create a checkpoint storm.
  useEffect(() => {
    if (!resume.trim() && !jobText.trim()) return;
    const timer = setTimeout(() => {
      try { setSavePoints(addSavePoint(
          { candidateName, resume, extraInfo },
          { jobText, jobUrl, jobTitle, company, emphasis, privacyMode, result },
        )); }
      catch (failure) { reportPersistenceFailure(failure); }
    }, 5000);
    return () => clearTimeout(timer);
  }, [candidateName, resume, extraInfo, jobText, jobUrl, jobTitle, company, emphasis, privacyMode, result, reportPersistenceFailure]);

  // Debounced autosave of the profile (all setState happens inside the timer callback)
  useEffect(() => {
    const t = setTimeout(() => {
      try { saveProfile({ candidateName, resume, extraInfo }); setSavedSnapshot({ candidateName, resume, extraInfo }); }
      catch (failure) { reportPersistenceFailure(failure); }
    }, 600);
    return () => clearTimeout(t);
  }, [candidateName, resume, extraInfo, reportPersistenceFailure]);

  const profileSaved =
    savedSnapshot === null ||
    (savedSnapshot.candidateName === candidateName && savedSnapshot.resume === resume && savedSnapshot.extraInfo === extraInfo);

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
      invalidateResult();
      setResume(data.text);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }, [invalidateResult]);

  const fetchJob = useCallback(async () => {
    const candidate = jobUrl.trim();
    if (!candidate) return;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(candidate);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      setJobUrlError("Enter a complete http:// or https:// job posting URL.");
      return;
    }
    setJobUrlError("");
    setFetching(true);
    setNotice("");
    try {
      const res = await fetch("/api/fetch-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: parsedUrl.toString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fetch failed.");
      invalidateResult();
      setJobText(data.text);
      if (data.title && !jobTitle) setJobTitle(String(data.title).slice(0, 160));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Fetch failed.");
    } finally {
      setFetching(false);
    }
  }, [jobUrl, jobTitle, invalidateResult]);

  const forge = useCallback(async (privacyOverride?: "protected" | "exact") => {
    const fullResume = extraInfo.trim()
      ? `${resume}\n\n--- Additional background the candidate provided (use as honest evidence, do not print verbatim) ---\n${extraInfo}`
      : resume;
    const protectedResume = protectPii(fullResume, { candidateNames: candidateName ? [candidateName] : [] });
    if (privacyMode === "review" && !privacyOverride && protectedResume.matches.length > 0) {
      setPendingPii(protectedResume.matches);
      return;
    }
    const sendProtected = privacyOverride === "protected" || (privacyMode === "protect" && privacyOverride !== "exact");
    const outboundResume = sendProtected ? protectedResume.text : fullResume;
    const restorationMap = sendProtected ? protectedResume.matches : [];
    setPendingPii([]);
    const controller = new AbortController();
    const generationId = ++activeGenerationRef.current;
    generationAbortRef.current = controller;
    cancelReasonRef.current = null;
    const timeout = window.setTimeout(() => {
      if (generationId !== activeGenerationRef.current) return;
      cancelReasonRef.current = "timeout";
      activeGenerationRef.current += 1;
      generationAbortRef.current = null;
      controller.abort();
      setError("Generation timed out after three minutes. Your inputs are safe; retry when ready.");
      setPhase("error");
    }, GENERATION_TIMEOUT_MS);
    setPhase("working");
    setThinking("");
    setProgressChars(0);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: outboundResume, jobDescription: jobText, jobTitle, company, emphasis }),
        signal: controller.signal,
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
            | { type: "error"; message: string; reasonCode?: "EVIDENCE_VALIDATION_FAILED" };
          if (generationId !== activeGenerationRef.current) return;
          if (event.type === "thinking") setThinking((t) => t + event.text);
          else if (event.type === "progress") setProgressChars(event.chars);
          else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "result") {
            const restoredResult = restorePii(event.data, restorationMap);
            setResult(restoredResult);
            try { setHistory(addHistory({ jobTitle, company, result: restoredResult })); }
            catch (failure) { reportPersistenceFailure(failure); }
            setPhase("done");
            finished = true;
          }
        }
      }
      if (!finished) throw new Error("The stream ended unexpectedly. Try again.");
      if (generationId !== activeGenerationRef.current) return;
      setTimeout(() => {
        if (generationId === activeGenerationRef.current) {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 80);
    } catch (err) {
      if (generationId !== activeGenerationRef.current) return;
      const cancelled = controller.signal.aborted;
      setError(
        cancelled
          ? cancelReasonRef.current === "timeout"
            ? "Generation timed out after three minutes. Your inputs are safe; retry when ready."
            : "Generation cancelled. Your inputs are safe and unchanged."
          : err instanceof Error ? err.message : "Something went wrong.",
      );
      setPhase("error");
    } finally {
      window.clearTimeout(timeout);
      if (generationId === activeGenerationRef.current) generationAbortRef.current = null;
    }
  }, [candidateName, resume, extraInfo, jobText, jobTitle, company, emphasis, privacyMode, reportPersistenceFailure]);

  const cancelGeneration = useCallback(() => {
    const controller = generationAbortRef.current;
    if (!controller) return;
    cancelReasonRef.current = "cancelled";
    activeGenerationRef.current += 1;
    generationAbortRef.current = null;
    controller.abort();
    setError("Generation cancelled. Your inputs are safe and unchanged.");
    setPhase("error");
  }, []);

  const clearJob = useCallback(() => {
    invalidateResult();
    setJobUrl("");
    setJobText("");
    setJobTitle("");
    setCompany("");
    setJobUrlError("");
    setResult(null);
    setPhase("idle");
    setNotice("Job fields cleared.");
  }, [invalidateResult]);

  const ready = resume.length >= 200 && jobText.length >= 100 && phase !== "working";
  const slug =
    `${company || "job"}-${jobTitle || "role"}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "tailored";

  const restoreSavePoint = useCallback((point: SavePoint) => {
    invalidateResult();
    setCandidateName(point.profile.candidateName ?? "");
    setResume(point.profile.resume);
    setExtraInfo(point.profile.extraInfo);
    setJobText(point.session.jobText);
    setJobUrl(point.session.jobUrl);
    setJobTitle(point.session.jobTitle);
    setCompany(point.session.company);
    setEmphasis(point.session.emphasis);
    setPrivacyMode(point.session.privacyMode ?? "protect");
    setResult(point.session.result);
    setPhase(point.session.result ? "done" : "idle");
    setNotice(`Restored save point from ${new Date(point.createdAt).toLocaleString()}.`);
  }, [invalidateResult]);

  const createManualSavePoint = useCallback(() => {
    try {
      setSavePoints(addSavePoint(
        { candidateName, resume, extraInfo },
        { jobText, jobUrl, jobTitle, company, emphasis, privacyMode, result },
        "Manual save point",
      ));
    } catch (failure) { reportPersistenceFailure(failure); }
  }, [candidateName, resume, extraInfo, jobText, jobUrl, jobTitle, company, emphasis, privacyMode, result, reportPersistenceFailure]);

  return (
    <div ref={pageRef} className="mx-auto max-w-6xl px-4 pb-24 pt-10 md:px-8">
      <SiteNav current="/" />
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
            <Chip tone="good">🔒 Stored only in your browser</Chip>
            <Chip tone="brass">Evidence-linked · human review required</Chip>
            <Chip tone="muted">Anthropic model configured by deployment</Chip>
            <p className="max-w-[17rem] text-[11px] leading-snug text-ink-400">
              Your profile and history are saved only in this browser. When you click Forge,
              your resume and the job text are sent to Anthropic&rsquo;s API to generate the
              result; this app keeps no server-side copy.
            </p>
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
            <div className="mb-4 max-w-md">
              <label htmlFor="candidate-name" className="mb-1 block text-xs text-ink-300">
                Your name for privacy protection
              </label>
              <input
                id="candidate-name"
                type="text"
                autoComplete="name"
                maxLength={120}
                value={candidateName}
                onChange={(event) => {
                  invalidateResult();
                  setCandidateName(event.target.value);
                }}
                placeholder="Jane Doe"
                className="w-full rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-sm text-ink-100 outline-none transition focus:border-brass-400/60"
              />
              <p className="mt-1 text-[10px] leading-snug text-ink-400">
                Optional. Protect mode masks this exact name locally; it never guesses which words are a person’s name.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="resume" className="text-xs text-ink-300">
                    Master resume — paste it, or upload PDF / .txt / .md
                  </label>
                  <div className="flex items-center gap-2">
                  <DictationButton
                    label="master resume"
                    onTranscript={(text) => {
                      invalidateResult();
                      setResume((value) => `${value}${value.trim() ? " " : ""}${text}`);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    aria-label="Upload resume file (PDF, .txt, or .md)"
                    className="cursor-pointer rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 transition hover:border-brass-400/60 hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {uploading ? <Spinner /> : "Upload file"}
                  </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.md,text/plain,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadResume(f);
                      e.target.value = "";
                    }}
                  />
                </div>
                <textarea
                  id="resume"
                  value={resume}
                  onChange={(e) => { invalidateResult(); setResume(e.target.value); }}
                  placeholder="JANE DOE — Senior Backend Engineer&#10;jane@…&#10;&#10;EXPERIENCE&#10;…paste your full resume here…"
                  className="h-56 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/80 p-3 font-mono text-xs leading-relaxed text-ink-100 outline-none transition focus:border-brass-400/60"
                />
                <p className="mt-1 text-right font-mono text-[10px] text-ink-400">{resume.length.toLocaleString()} chars</p>
              </div>
              <div>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <label htmlFor="extra" className="block text-xs text-ink-300">
                    Everything else — projects, wins, metrics, constraints that never fit on the resume
                  </label>
                  <DictationButton
                    label="additional career evidence"
                    onTranscript={(text) => {
                      invalidateResult();
                      setExtraInfo((value) => `${value}${value.trim() ? " " : ""}${text}`);
                    }}
                  />
                </div>
                <textarea
                  id="extra"
                  value={extraInfo}
                  onChange={(e) => { invalidateResult(); setExtraInfo(e.target.value); }}
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
            <div className="mb-3 flex min-w-0 flex-wrap gap-2">
              <input
                id="job-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={jobUrl}
                onChange={(e) => {
                  invalidateResult();
                  setJobUrl(e.target.value);
                  setJobUrlError(
                    !e.target.value.trim() || validJobUrl(e.target.value)
                      ? ""
                      : "Enter a complete http:// or https:// job posting URL.",
                  );
                }}
                onBlur={(e) => {
                  const candidate = e.target.value.trim();
                  if (!candidate) {
                    setJobUrlError("");
                    return;
                  }
                  try {
                    const parsed = new URL(candidate);
                    setJobUrlError(
                      ["http:", "https:"].includes(parsed.protocol)
                        ? ""
                        : "Enter a complete http:// or https:// job posting URL.",
                    );
                  } catch {
                    setJobUrlError("Enter a complete http:// or https:// job posting URL.");
                  }
                }}
                onKeyDown={(e) => e.key === "Enter" && void fetchJob()}
                aria-label="Job posting URL"
                aria-invalid={jobUrlError ? "true" : "false"}
                aria-describedby={jobUrlError ? "job-url-error" : undefined}
                placeholder="https://job-boards.greenhouse.io/…  (LinkedIn links often require login — paste the text below instead)"
                className="min-w-0 flex-1 basis-full rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-xs text-ink-100 outline-none transition focus:border-brass-400/60 sm:basis-auto sm:min-w-64"
              />
              <button
                type="button"
                onClick={() => void fetchJob()}
                disabled={fetching || !validJobUrl(jobUrl)}
                className="rounded-lg border border-brass-400/50 bg-brass-400/10 px-4 py-2 text-xs font-semibold text-brass-300 transition hover:bg-brass-400/20 disabled:opacity-40"
              >
                {fetching ? <Spinner /> : "Fetch posting"}
              </button>
            </div>
            {jobUrlError && (
              <p id="job-url-error" role="alert" className="-mt-1 mb-3 text-xs text-bad">
                {jobUrlError}
              </p>
            )}
            <div className="mb-2 flex justify-end">
              <DictationButton
                label="job description"
                onTranscript={(text) => {
                  invalidateResult();
                  setJobText((value) => `${value}${value.trim() ? " " : ""}${text}`);
                }}
              />
            </div>
            <label htmlFor="job-description" className="sr-only">Job description</label>
            <textarea
              id="job-description"
              value={jobText}
              onChange={(e) => { invalidateResult(); setJobText(e.target.value); }}
              placeholder="…or paste the full job description here…"
              className="h-40 w-full resize-y rounded-lg border border-ink-700 bg-ink-950/80 p-3 font-mono text-xs leading-relaxed text-ink-100 outline-none transition focus:border-brass-400/60"
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label htmlFor="job-title" className="sr-only">Job title (optional)</label>
              <input
                id="job-title"
                value={jobTitle}
                onChange={(e) => { invalidateResult(); setJobTitle(e.target.value); }}
                placeholder="Job title (optional)"
                className="rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-xs text-ink-100 outline-none transition focus:border-brass-400/60"
              />
              <label htmlFor="job-company" className="sr-only">Company (optional)</label>
              <input
                id="job-company"
                value={company}
                onChange={(e) => { invalidateResult(); setCompany(e.target.value); }}
                placeholder="Company (optional)"
                className="rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-xs text-ink-100 outline-none transition focus:border-brass-400/60"
              />
              <label htmlFor="tailoring-emphasis" className="sr-only">Tailoring emphasis</label>
              <select
                id="tailoring-emphasis"
                value={emphasis}
                onChange={(e) => { invalidateResult(); setEmphasis(e.target.value as typeof emphasis); }}
                className="rounded-lg border border-ink-700 bg-ink-950/80 px-3 py-2 text-xs text-ink-100 outline-none transition focus:border-brass-400/60"
              >
                <option value="balanced">Emphasis: balanced</option>
                <option value="technical">Emphasis: technical depth</option>
                <option value="leadership">Emphasis: leadership</option>
              </select>
            </div>
            <div className="mt-3 flex justify-end">
              <ToolButton onClick={clearJob}>Clear job</ToolButton>
            </div>
            {notice && <p className="mt-2 text-xs text-warn">{notice}</p>}
          </Section>
        </div>

        <JobInbox
          current={{
            company: company.trim() || "Unknown company",
            title: jobTitle.trim() || "Untitled role",
            description: jobText,
            applicationUrl: jobUrl,
          }}
          onSelect={(job) => {
            invalidateResult();
            setJobText(job.description);
            setJobUrl(job.applicationUrl);
            setJobTitle(job.title);
            setCompany(job.company);
            setNotice(`Loaded immutable snapshot revision ${job.revision} from the Job Inbox.`);
          }}
        />

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
        <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-paper">Personal information shield</h2>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-ink-400">
                Contact details and the name you explicitly enter above are replaced locally before
                generation and restored afterward. Names are never guessed. You can review detected
                fields or send your exact text whenever you choose.
              </p>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-ink-400">
                Read-aloud uses your browser/device voice. Dictation starts only when you press its
                button and may use your browser or operating-system speech provider.
              </p>
            </div>
            <select
              aria-label="Personal information protection mode"
              value={privacyMode}
              onChange={(event) => { invalidateResult(); setPrivacyMode(event.target.value as PrivacyMode); }}
              className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-xs text-ink-100"
            >
              <option value="protect">Protect automatically</option>
              <option value="review">Let me review first</option>
              <option value="exact">Send exactly what I entered</option>
            </select>
          </div>
          {privacyMode === "exact" && (
            <p role="status" className="mt-3 text-xs text-warn">
              Exact mode may send your name, email addresses, phone numbers, profile links,
              addresses, or other identifiers to Anthropic. You can switch back at any time.
            </p>
          )}
        </div>

        {pendingPii.length > 0 && (
          <div
            ref={reviewDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="pii-review-title"
            className="rounded-xl border border-warn/50 bg-warn/10 p-4"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closePiiReview();
                return;
              }
              if (event.key !== "Tab") return;
              const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
              if (controls.length === 0) return;
              const first = controls[0];
              const last = controls.at(-1)!;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <h2 id="pii-review-title" className="font-semibold text-paper">Review before anything leaves this browser</h2>
            <p className="mt-1 text-xs text-ink-300">
              Found {pendingPii.length} personal field{pendingPii.length === 1 ? "" : "s"}: {Array.from(new Set(pendingPii.map((match) => match.kind))).join(", ")}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ToolButton ref={protectedChoiceRef} onClick={() => { restoreForgeFocusRef.current = true; void forge("protected"); }}>Send protected copy</ToolButton>
              <ToolButton onClick={() => { restoreForgeFocusRef.current = true; void forge("exact"); }}>Send exact text once</ToolButton>
              <ToolButton onClick={closePiiReview}>Cancel</ToolButton>
            </div>
          </div>
        )}

        <div className="rise flex flex-col items-center gap-4 py-2" style={{ animationDelay: "240ms" }}>
          <button
            ref={forgeButtonRef}
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
          {phase === "working" && (
            <button
              type="button"
              onClick={cancelGeneration}
              className="rounded-lg border border-bad/50 bg-bad/10 px-4 py-2 text-xs font-semibold text-bad hover:bg-bad/20"
            >
              Cancel generation
            </button>
          )}
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
            <div className="mt-3"><ToolButton onClick={() => void forge()}>Retry generation</ToolButton></div>
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
              <ResultView result={result} slug={slug} onResultChange={setResult} />
            </div>
          )}
        </div>

        <CareerLedger />
        <CareerPathPlanner />

        <SensitiveAttestationBoundary />

        <Connections />

        <ApplicationTracker
          result={result}
          profile={{ resume, extraInfo }}
          job={{ company, title: jobTitle, description: jobText, applicationUrl: jobUrl }}
        />

        {/* History */}
        <section className="mt-10 border-t border-ink-700 pt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-paper">Save points</h2>
              <p className="text-[11px] text-ink-400">
                Automatic recovery checkpoints stay in this browser; the newest 12 are kept.
              </p>
            </div>
            <ToolButton
              onClick={createManualSavePoint}
            >
              Save point now
            </ToolButton>
          </div>
          {savePoints.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-700 p-4 text-xs text-ink-400">
              Your first checkpoint appears after you pause typing for five seconds.
            </p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {savePoints.map((point) => (
                <li
                  key={point.id}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/70 px-4 py-3"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => restoreSavePoint(point)}
                  >
                    <span className="block truncate text-sm text-ink-100">{point.label}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-400">
                      {new Date(point.createdAt).toLocaleString()} · {point.session.jobTitle || "draft"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { try { setSavePoints(deleteSavePoint(point.id)); } catch (failure) { reportPersistenceFailure(failure); } }}
                    className="shrink-0 text-xs text-ink-400 transition hover:text-bad"
                    aria-label={`Delete save point from ${new Date(point.createdAt).toLocaleString()}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 border-t border-ink-700 pt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-paper">
                Past runs <span className="text-ink-400">(stored only in this browser)</span>
              </h2>
              <ToolButton
                onClick={async () => {
                  if (confirm("Delete all your saved Resume Foundry data from this browser?")) {
                    activeGenerationRef.current += 1;
                    generationAbortRef.current?.abort();
                    generationAbortRef.current = null;
                    try { await clearAllData(); }
                    catch (failure) { reportPersistenceFailure(failure); }
                    finally {
                      setHistory([]); setSavePoints([]); setCandidateName(""); setResume(""); setExtraInfo("");
                      setJobText(""); setJobUrl(""); setJobTitle(""); setCompany(""); setEmphasis("balanced");
                      setPrivacyMode("protect"); setPendingPii([]); setResult(null); setPhase("idle");
                      setThinking(""); setProgressChars(0); setError("");
                    }
                  }
                }}
              >
                Erase all my data
              </ToolButton>
            </div>
            {history.length > 0 && <ul className="grid gap-2 md:grid-cols-2">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="flex min-w-0 max-w-full items-center justify-between gap-3 overflow-hidden rounded-lg border border-ink-700 bg-ink-900/70 px-4 py-3"
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
                    onClick={() => { try { setHistory(deleteHistory(h.id)); } catch (failure) { reportPersistenceFailure(failure); } }}
                    className="shrink-0 text-xs text-ink-400 transition hover:text-bad"
                    aria-label="Delete entry"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>}
          </section>
      </main>
      )}

      <footer className="mt-16 border-t border-ink-700 pt-6 text-center font-mono text-[11px] leading-relaxed text-ink-400">
        Honest tailoring only — nothing is invented, and keywords the model can’t evidence are listed, not faked.
        <br />
        Your profile and history live in this browser’s localStorage. This app does not write a
        server-side copy.
      </footer>
    </div>
  );
}
