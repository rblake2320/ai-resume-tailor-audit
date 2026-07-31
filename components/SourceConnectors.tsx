"use client";

import { useState } from "react";
import type { JobImportInput } from "@/lib/job-inbox";
import { ToolButton } from "@/components/ui";

export function SourceConnectors({ onJobs }: { onJobs: (jobs: JobImportInput[]) => Promise<void> }) {
  const [source, setSource] = useState<"greenhouse" | "lever" | "usajobs" | "email">("greenhouse");
  const [query, setQuery] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function run() {
    setBusy(true); setMessage("");
    try {
      const body = source === "email" ? { source, payload: query } : { source, query, maxPages: 3 };
      const response = await fetch("/api/jobs/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Connector failed.");
      await onJobs(payload.jobs as JobImportInput[]); setMessage(`${payload.count} ${source} job${payload.count === 1 ? "" : "s"} received.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Connector failed."); }
    finally { setBusy(false); }
  }
  const placeholder = source === "greenhouse" ? "Greenhouse board token" : source === "lever" ? "Lever site token" : source === "usajobs" ? "USAJOBS keyword" : "Paste a forwarded job-alert email";
  return <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/50 p-3"><div className="flex min-w-0 flex-wrap gap-2"><select value={source} onChange={(event) => { setSource(event.target.value as typeof source); setQuery(""); }} aria-label="Job source" className="max-w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs"><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="usajobs">USAJOBS</option><option value="email">Forwarded alert</option></select>{source === "email" ? <textarea aria-label={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="min-h-24 min-w-0 basis-full flex-1 rounded border border-ink-700 bg-ink-950 p-2 text-xs sm:basis-auto" /> : <input aria-label={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="min-w-0 basis-full flex-1 rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs sm:basis-auto" />}<ToolButton onClick={() => void run()}>{busy ? "Importing…" : "Import source"}</ToolButton></div>{message && <p role="status" className="mt-2 text-xs text-brass-300">{message}</p>}<p className="mt-2 text-[10px] text-ink-400">Official feeds only. LinkedIn and Indeed remain manual/guided handoff sources; Foundry does not scrape or automate them.</p></div>;
}
