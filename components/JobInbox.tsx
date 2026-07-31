"use client";

import { useEffect, useRef, useState } from "react";
import { addJobSnapshot, createJobSnapshot, parseJobImport, type JobImportInput } from "@/lib/job-inbox";
import type { JobPostingSnapshot } from "@/lib/schema";
import { deleteJobSnapshot, loadJobInbox, saveJobInbox } from "@/lib/storage";
import { ToolButton } from "@/components/ui";
import { SourceConnectors } from "@/components/SourceConnectors";

export function JobInbox({ current, onSelect }: { current: JobImportInput; onSelect: (job: JobPostingSnapshot) => void }) {
  const [jobs, setJobs] = useState<JobPostingSnapshot[]>(() => loadJobInbox());
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cleared = () => { setJobs([]); setMessage("Job Inbox erased from this browser."); };
    window.addEventListener("resume-foundry:data-cleared", cleared);
    return () => window.removeEventListener("resume-foundry:data-cleared", cleared);
  }, []);

  async function addInputs(inputs: JobImportInput[]) {
    let next = jobs, added = 0, duplicates = 0, rejected = 0;
    for (const input of inputs) {
      try {
        const snapshot = await createJobSnapshot(input, next);
        const result = addJobSnapshot(next, snapshot);
        next = result.jobs;
        if (result.added) added += 1;
        else duplicates += 1;
      } catch { rejected += 1; }
    }
    try { saveJobInbox(next); setJobs(next); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Job Inbox could not be saved."); return; }
    setMessage(`${added} imported · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped${rejected ? ` · ${rejected} invalid` : ""}`);
  }

  async function importFile(file: File) {
    const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
    try { await addInputs(parseJobImport(await file.text(), format)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
  }

  return <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-4" aria-labelledby="job-inbox-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="job-inbox-heading" className="font-display text-xl font-semibold text-paper">Job Inbox</h2><p className="text-[11px] text-ink-400">Immutable posting snapshots stored only in this browser.</p></div>
      <div className="flex flex-wrap gap-2">
        <ToolButton onClick={() => void addInputs([{ ...current, source: current.applicationUrl ? "url" : "manual" }])}>Save current job</ToolButton>
        <ToolButton onClick={() => fileRef.current?.click()}>Import CSV/JSON</ToolButton>
        <input ref={fileRef} className="sr-only" type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
      </div>
    </div>
    <SourceConnectors onJobs={addInputs} />
    {message && <p role="status" className="mt-2 text-xs text-brass-300">{message}</p>}
    {jobs.length === 0 ? <p className="mt-3 rounded-lg border border-dashed border-ink-700 p-4 text-xs text-ink-400">No saved jobs yet. Load or paste a posting, then save it here.</p> :
      <ul className="mt-3 grid gap-2 md:grid-cols-2">{jobs.map((job) => <li key={job.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-ink-700 px-3 py-2">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(job)}><span className="block truncate text-sm text-paper">{job.title} <span className="text-brass-300">@ {job.company}</span></span><span className="block truncate font-mono text-[10px] text-ink-400">{job.source} · revision {job.revision} · {job.location || "location unspecified"}</span></button>
        <button type="button" className="text-xs text-ink-400 hover:text-bad" aria-label={`Delete ${job.title} snapshot`} onClick={() => { try { setJobs(deleteJobSnapshot(job.id)); } catch (error) { setMessage(error instanceof Error ? error.message : "Job snapshot could not be deleted."); } }}>✕</button>
      </li>)}</ul>}
  </section>;
}
