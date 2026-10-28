"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setPilotTelemetryConsent, trackPilotEvent } from "@/lib/pilot-telemetry";
import { ResultView } from "./ResultView";
import { TailorResultSchema } from "@/lib/schema";

const PilotContext = createContext({ enabled: false, aiEnabled: true });
export const usePilot = () => useContext(PilotContext);
const sample = TailorResultSchema.parse({ match_score_before: 40, match_score_after: 65,
  score_rationale: "Illustrative sample scores, not an ATS measurement or a hiring prediction.",
  changes: [], keywords: { matched: [], added: [], not_added: [] }, gap_analysis: [],
  requirement_evidence: [], ats_checks: [],
  tailored_resume_markdown: "# Alex Example\n\n## Experience\n**Software developer — Example Company**\n\n- Built TypeScript interfaces and maintained SQL reporting.\n- Reviewed code with colleagues and documented releases.\n\n## Skills\nTypeScript, SQL, technical writing",
  cover_letter_markdown: "Dear Hiring Team,\n\nMy experience building TypeScript interfaces and maintaining SQL reporting aligns with your software developer role. I value clear documentation and collaborative code review.\n\nSincerely,\nAlex Example",
});

export function PilotProvider({ enabled, aiEnabled, children }: { enabled: boolean; aiEnabled: boolean; children: ReactNode }) {
  return <PilotContext.Provider value={{ enabled, aiEnabled }}>
    {enabled && <PilotPanel aiEnabled={aiEnabled} />}{children}
  </PilotContext.Provider>;
}

function PilotPanel({ aiEnabled }: { aiEnabled: boolean }) {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(4);
  const [accuracy, setAccuracy] = useState("not_tested");
  const [goal, setGoal] = useState("tailor_resume");
  const [outcome, setOutcome] = useState("not_tested");
  const [comment, setComment] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [showSample, setShowSample] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/pilot/session", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Tester session could not be checked.");
      const body = await response.json();
      if (typeof body.consent !== "boolean") throw new Error("Invalid tester consent response.");
      if (!active) return;
      setConsent(body.consent); setPilotTelemetryConsent(body.consent);
      if (body.consent) trackPilotEvent("session_started", { device: matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop" });
    }).catch(() => { if (active) setMessage("Usage tracking is off. Your tester session could not be checked."); });
    return () => { active = false; setPilotTelemetryConsent(false); };
  }, []);

  async function allow() {
    setBusy(true);
    try {
      const response = await fetch("/api/pilot/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true, version: "2026-10-01-v1" }) });
      if (!response.ok) throw new Error("Consent could not be saved. Tracking remains off.");
      setConsent(true); setPilotTelemetryConsent(true);
      trackPilotEvent("session_started", { device: matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop" });
      setMessage("Usage sharing is on. You can withdraw and delete it here anytime.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Consent could not be saved."); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    setPilotTelemetryConsent(false); setBusy(true);
    try {
      const response = await fetch("/api/pilot/data", { method: "DELETE" });
      if (!response.ok) throw new Error("Tracking is off in this tab, but cloud deletion failed. Try again.");
      setConsent(false); setMessage("Your shared usage and feedback were deleted. Your private browser résumé stays here.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Deletion failed."); }
    finally { setBusy(false); }
  }

  async function feedback() {
    setBusy(true);
    try {
      const response = await fetch("/api/pilot/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating, accuracy, goal, outcome, comment, reviewed }) });
      if (!response.ok) throw new Error("Feedback was not saved. Check your consent and try again.");
      setComment(""); setReviewed(false); setMessage("Thank you — your feedback was saved for the product owner.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Feedback could not be saved."); }
    finally { setBusy(false); }
  }

  return <aside aria-label="Tester pilot" className="mx-auto my-4 max-w-5xl rounded-xl border border-brass-400/40 bg-ink-900 p-4 text-xs text-ink-200 print:hidden">
    <p className="font-semibold text-paper">Resume Foundry tester pilot</p>
    <p className="mt-2">Help improve the workshop. Optional sharing records steps used, timings, completion/error categories, scores and your feedback under a random tester ID. No résumé/job text, names, links, keystrokes, IP addresses or browser fingerprints are included in usage analytics. Shared records expire after 30 days. Access sessions and minimal safety counters are required even when optional tracking is off.</p>
    <p className="mt-2">Your saved résumé stays in this browser. {aiEnabled ? "Real tailoring sends your selected text through Cloudflare to the operator’s local Qwen model. Paid providers are disabled. Review privacy protection before generating. The free pilot accepts up to 12,000 combined résumé/job characters, one generation at a time, three per tester and ten total per day." : "Live AI is paused. Try job imports, storage and the labelled sample result below."}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {consent !== true && <button disabled={busy || consent === null} onClick={() => void allow()} className="rounded border border-brass-400 px-3 py-2">Allow usage sharing</button>}
      {consent !== true && <button disabled={busy || consent === null} onClick={() => { setPilotTelemetryConsent(false); setConsent(false); setMessage("Usage tracking is off. You can continue testing."); }} className="rounded border border-ink-600 px-3 py-2">Continue without tracking</button>}
      {consent === true && <button disabled={busy} onClick={() => void withdraw()} className="rounded border border-ink-600 px-3 py-2">Withdraw and delete shared data</button>}
      <button onClick={() => { setShowSample(!showSample); if (!showSample) trackPilotEvent("demo_opened"); }} className="rounded border border-ink-600 px-3 py-2">{showSample ? "Close sample result" : "Explore a sample result"}</button>
      <button onClick={() => { setPilotTelemetryConsent(false); void fetch("/api/pilot/logout", { method: "POST" }).then((response) => { if (response.ok) location.assign("/pilot/login"); else setMessage("Sign-out failed. Try again."); }).catch(() => setMessage("Sign-out failed. Try again.")); }} className="rounded border border-ink-600 px-3 py-2">Sign out</button>
    </div>
    {showSample && <div className="mt-4"><p className="mb-3 font-semibold text-brass-300">Synthetic sample — not generated from your résumé. Sample scores are illustrative.</p><ResultView result={sample} slug="sample-example" sample /></div>}
    <details className="mt-4"><summary className="cursor-pointer font-semibold text-paper">Send tester feedback</summary>
      <p className="mt-2">Optional, visible to the product owner. Please omit names, employer details, contact information and résumé text. Sharing requires consent above and your review below.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>Overall rating<select aria-label="Overall rating" value={rating} onChange={(event) => setRating(Number(event.target.value))} className="ml-2 rounded bg-ink-950 p-2">{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
        <label>What did you try?<select value={goal} onChange={(event) => setGoal(event.target.value)} className="ml-2 rounded bg-ink-950 p-2">{[["tailor_resume","Résumé tailoring"],["cover_letter","Cover letter"],["job_import","Job import"],["tracking","Application tracking"],["other","Other"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Result accuracy<select value={accuracy} onChange={(event) => setAccuracy(event.target.value)} className="ml-2 rounded bg-ink-950 p-2">{[["not_tested","Not tested"],["accurate","Accurate"],["minor_issues","Minor issues"],["major_issues","Major issues"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Application outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)} className="ml-2 rounded bg-ink-950 p-2">{[["not_tested","Not tested"],["not_applied","Not applied"],["applied","Applied"],["interview","Interview"],["offer","Offer"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <label className="mt-3 block">What worked or got in your way?<textarea value={comment} maxLength={2000} onChange={(event) => { setComment(event.target.value); setReviewed(false); }} className="mt-2 block min-h-20 w-full rounded bg-ink-950 p-2" /></label>
      <label className="mt-3 block"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed this feedback and agree to share it with the product owner.</label>
      <button disabled={busy || consent !== true || !reviewed} onClick={() => void feedback()} className="mt-3 rounded border border-brass-400 px-3 py-2">Send feedback</button>
    </details>
    {message && <p role="status" className="mt-3 text-brass-300">{message}</p>}
  </aside>;
}
