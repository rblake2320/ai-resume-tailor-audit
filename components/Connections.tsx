"use client";

import { useEffect, useState } from "react";
import { ToolButton } from "@/components/ui";

type Status = { connected: boolean; configured: boolean; features?: string[]; scopes?: string[]; error?: string };
export function Connections() {
  const [status, setStatus] = useState<Status | null>(null);
  const [features, setFeatures] = useState<string[]>(["email_alerts"]);
  useEffect(() => { void fetch("/api/connections/google/status").then((response) => response.json()).then(setStatus).catch(() => setStatus({ connected: false, configured: false, error: "Connection status unavailable." })); }, []);
  const toggle = (feature: string) => setFeatures((current) => current.includes(feature) ? current.filter((item) => item !== feature) : [...current, feature]);
  async function disconnect() { const response = await fetch("/api/connections/google/disconnect", { method: "POST" }); setStatus(await response.json() as Status); }
  return <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-4" aria-labelledby="connections-heading"><h2 id="connections-heading" className="font-display text-xl font-semibold text-paper">Email & calendar connections</h2><p className="text-[11px] text-ink-400">Choose only the permissions you need. Tokens remain encrypted and unavailable to browser scripts.</p>
    <p role="status" className="mt-2 text-xs text-brass-300">{status === null ? "Checking connection…" : status.connected ? `Connected: ${status.features?.join(", ")}` : status.configured ? "Configured but not connected." : "Not configured on this server."} {status?.error}</p>
    {!status?.connected && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-300">{[["email_alerts", "Read job-alert email"], ["email_drafts", "Create email drafts"], ["calendar_events", "Manage your interview events"]].map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="checkbox" checked={features.includes(value)} onChange={() => toggle(value)}/>{label}</label>)}<a aria-disabled={!status?.configured || !features.length} className={`rounded border border-ink-600 px-3 py-2 ${status?.configured && features.length ? "text-paper" : "pointer-events-none text-ink-600"}`} href={`/api/connections/google/start?features=${encodeURIComponent(features.join(","))}`}>Connect Google</a></div>}
    {status?.connected && <div className="mt-3"><ToolButton onClick={() => void disconnect()}>Disconnect</ToolButton></div>}
  </section>;
}
