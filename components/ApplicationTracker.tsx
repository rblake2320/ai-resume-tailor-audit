"use client";

import { useState } from "react";
import type { TailorResult } from "@/lib/schema";
import { createJobSnapshot } from "@/lib/job-inbox";
import { allowedTransitions, applicationAnalytics, createApplicationPacket, createApplicationRecord, transitionApplication, type ApplicationRecord, type ApplicationState } from "@/lib/applications";
import { loadApplications, loadJobInbox, saveApplications } from "@/lib/storage";
import { ToolButton } from "@/components/ui";

export function ApplicationTracker({ result, profile, job }: { result: TailorResult | null; profile: { resume: string; extraInfo: string }; job: { company: string; title: string; description: string; applicationUrl: string } }) {
  const [records, setRecords] = useState<ApplicationRecord[]>(() => loadApplications());
  const [message, setMessage] = useState("");
  const analytics = applicationAnalytics(records);

  async function prepare() {
    if (!result) { setMessage("Generate and review a tailored result before preparing an application packet."); return; }
    const existing = loadJobInbox();
    const jobSnapshot = await createJobSnapshot({ ...job, company: job.company || "Unknown company", title: job.title || "Untitled role", source: job.applicationUrl ? "url" : "manual" }, existing);
    const packet = await createApplicationPacket({ jobSnapshot, profile, result });
    const next = [createApplicationRecord(packet), ...records]; saveApplications(next); setRecords(next); setMessage("Immutable packet prepared and checksummed.");
  }

  async function move(record: ApplicationRecord, state: ApplicationState) {
    const transitioned = await transitionApplication(record, state);
    const next = records.map((entry) => entry.id === record.id ? transitioned : entry);
    saveApplications(next); setRecords(next);
  }

  return <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-4" aria-labelledby="application-tracker-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="application-tracker-heading" className="font-display text-xl font-semibold text-paper">Application tracker</h2><p className="text-[11px] text-ink-400">Each packet keeps the exact job, profile, résumé, cover letter, and checksums used.</p></div><ToolButton onClick={() => void prepare()}>Prepare immutable packet</ToolButton></div>
    {message && <p role="status" className="mt-2 text-xs text-brass-300">{message}</p>}
    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
      <Metric label="Applications" value={records.length} /><Metric label="Response rate" value={`${Math.round(analytics.responseRate * 100)}%`} /><Metric label="Interview conversion" value={`${Math.round(analytics.interviewConversionRate * 100)}%`} /><Metric label="Awaiting follow-up" value={analytics.companiesAwaitingFollowUp.length} />
    </div>
    {records.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-xs"><thead className="text-ink-400"><tr><th className="p-2">Role</th><th className="p-2">State</th><th className="p-2">Packet</th><th className="p-2">Next valid state</th></tr></thead><tbody>{records.map((record) => <tr key={record.id} className="border-t border-ink-700"><td className="p-2 text-paper">{record.packet.jobSnapshot.title} @ {record.packet.jobSnapshot.company}</td><td className="p-2 text-brass-300">{record.state.replaceAll("_", " ")}</td><td className="p-2 font-mono text-[10px] text-ink-400">v{record.packet.version} · {record.packet.checksums.packet.slice(0, 12)}…</td><td className="p-2"><select aria-label={`Move ${record.packet.jobSnapshot.title} to next state`} value="" onChange={(event) => void move(record, event.target.value as ApplicationState)} className="rounded border border-ink-700 bg-ink-950 p-1"><option value="" disabled>Choose…</option>{allowedTransitions(record.state).map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}</select></td></tr>)}</tbody></table></div>}
    <details className="mt-4"><summary className="cursor-pointer text-xs text-ink-300">Analytics detail</summary><div className="mt-2 grid gap-2 text-[11px] text-ink-400 md:grid-cols-2"><pre className="overflow-auto rounded bg-ink-950 p-2">Applications/week {JSON.stringify(analytics.applicationsPerWeek, null, 2)}</pre><pre className="overflow-auto rounded bg-ink-950 p-2">Source effectiveness {JSON.stringify(analytics.sourceEffectiveness, null, 2)}</pre><pre className="overflow-auto rounded bg-ink-950 p-2">Resume versions {JSON.stringify(analytics.resumeVersionEffectiveness, null, 2)}</pre><pre className="overflow-auto rounded bg-ink-950 p-2">Missing skills {JSON.stringify(analytics.skillsMostOftenMissing, null, 2)}</pre><pre className="overflow-auto rounded bg-ink-950 p-2">Roles needing attention {JSON.stringify(analytics.rolesNeedingAttention, null, 2)}</pre><pre className="overflow-auto rounded bg-ink-950 p-2">Average response hours {JSON.stringify(analytics.averageResponseHours)}</pre></div></details>
  </section>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg border border-ink-700 bg-ink-950 p-3"><span className="block font-mono text-lg text-brass-300">{value}</span><span className="text-[10px] text-ink-400">{label}</span></div>; }
