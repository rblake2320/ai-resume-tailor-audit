"use client";

import { useEffect, useState } from "react";
import { ToolButton } from "@/components/ui";
import { addJobSnapshot, createJobSnapshot } from "@/lib/job-inbox";
import { loadJobInbox, saveJobInbox } from "@/lib/storage";
import type { GoogleJobAlert, GoogleWriteAction } from "@/lib/google-workflows";

type Status = { connected: boolean; configured: boolean; features?: string[]; error?: string };
type Review = { id: string; action: GoogleWriteAction; expiresAt: number };
type Receipt = { providerId: string; verified: boolean; sent?: boolean; link: string; type: string };
const inputClass = "w-full rounded border border-ink-600 bg-ink-950 p-2 text-xs text-paper";

function AlertCard({ alert }: { alert: GoogleJobAlert }) {
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState(alert.subject);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  async function importAlert() {
    try {
      const jobs = loadJobInbox();
      if (jobs.some((job) => job.source === "email" && job.sourceId === `gmail:${alert.id}`)) { setMessage("This alert is already in Job Inbox."); return; }
      const snapshot = await createJobSnapshot({ source: "email", sourceId: `gmail:${alert.id}`, company, title, description: alert.text, applicationUrl: url }, jobs);
      const result = addJobSnapshot(jobs, snapshot);
      saveJobInbox(result.jobs);
      window.dispatchEvent(new Event("resume-foundry:jobs-imported"));
      setMessage(result.added ? "Saved to Job Inbox in this browser." : "This alert is already in Job Inbox.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Alert could not be saved."); }
  }
  return <li className="rounded-lg border border-ink-700 p-3"><p className="text-sm text-paper">{alert.subject || "Untitled alert"}</p><p className="text-xs text-ink-400">{alert.from}</p><pre className="my-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs text-ink-300">{alert.text || "No plain text found. Review the original message in Gmail."}</pre><div className="grid gap-2 md:grid-cols-3"><label className="text-xs text-ink-400">Employer<input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} /></label><label className="text-xs text-ink-400">Role<input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} /></label><label className="text-xs text-ink-400">Application URL (optional)<input type="url" className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} /></label></div><ToolButton disabled={!company.trim() || !title.trim() || alert.text.trim().length < 100} onClick={() => void importAlert()}>Import reviewed alert to Job Inbox</ToolButton>{message && <p role="status" className="text-xs text-brass-300">{message}</p>}</li>;
}
export function Connections() {
  const [status, setStatus] = useState<Status | null>(null);
  const [features, setFeatures] = useState<string[]>(["email_alerts"]);
  const [query, setQuery] = useState('newer_than:30d {subject:"job alert" subject:"new jobs" subject:"job opportunities"}');
  const [alerts, setAlerts] = useState<GoogleJobAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [event, setEvent] = useState({ title: "Interview", description: "", start: "", end: "", reminderMinutes: 30 });
  const [draft, setDraft] = useState({ to: "", subject: "", body: "" });
  useEffect(() => {
    void fetch("/api/connections/google/status", { cache: "no-store" }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(); return result; }).then(setStatus).catch(() => setStatus({ connected: false, configured: false, error: "Connection status unavailable." }));
    const clear = () => { setAlerts([]); setDraft({ to: "", subject: "", body: "" }); setReview(null); setReceipt(null); };
    window.addEventListener("resume-foundry:data-cleared", clear);
    return () => window.removeEventListener("resume-foundry:data-cleared", clear);
  }, []);
  const toggle = (feature: string) => setFeatures((current) => current.includes(feature) ? current.filter((item) => item !== feature) : [...current, feature]);
  useEffect(() => {
    if (!review) return;
    const timer = window.setTimeout(() => { setReview(null); setMessage("Review expired. Review the action again before creating it."); }, Math.max(0, review.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [review]);
  async function action(body: unknown) {
    setBusy(true); setMessage(""); setReceipt(null);
    try {
      const response = await fetch("/api/connections/google/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Google action failed.");
      if (data.alerts) { setAlerts(data.alerts); setMessage(`${data.alerts.length} alerts fetched. Review before importing.`); }
      if (data.review) setReview(data.review);
      if (data.receipt) { setReceipt(data.receipt); setReview(null); setMessage(data.receipt.type === "email_draft" ? "Draft created and read back from Gmail." : "Event and popup reminder created and read back from Calendar."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Google action failed."); }
    finally { setBusy(false); }
  }
  async function reviewEvent() { try { await action({ operation: "review", action: { type: "calendar_event", ...event, start: new Date(event.start).toISOString(), end: new Date(event.end).toISOString() } }); } catch { setMessage("Choose valid start and end times."); } }
  async function disconnect() {
    setBusy(true);
    try { const response = await fetch("/api/connections/google/disconnect", { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Disconnect failed."); setStatus({ ...data, configured: status?.configured ?? false }); setAlerts([]); setReview(null); setReceipt(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Disconnect failed."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-4" aria-labelledby="connections-heading"><h2 id="connections-heading" className="font-display text-xl font-semibold text-paper">Email & calendar connections</h2><p className="text-[11px] text-ink-400">Choose only the permissions you need. Tokens remain encrypted and unavailable to browser scripts.</p>
    <p role="status" className="mt-2 text-xs text-brass-300">{status === null ? "Checking connection…" : status.connected ? `Connected: ${status.features?.join(", ")}` : status.configured ? "Configured but not connected." : "Not configured on this server."} {status?.error}</p>
    {!status?.connected && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-300">{[["email_alerts", "Read job-alert email"], ["email_drafts", "Create email drafts"], ["calendar_events", "Manage your interview events"]].map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="checkbox" checked={features.includes(value)} onChange={() => toggle(value)}/>{label}</label>)}<a aria-disabled={!status?.configured || !features.length} className={`rounded border border-ink-600 px-3 py-2 ${status?.configured && features.length ? "text-paper" : "pointer-events-none text-ink-600"}`} href={`/api/connections/google/start?features=${encodeURIComponent(features.join(","))}`}>Connect Google</a></div>}
    {status?.connected && <div className="mt-3 space-y-4">
      {status.features?.includes("email_alerts") && <div className="space-y-2"><label className="block text-xs text-ink-400">Gmail search for job alerts<input className={inputClass} maxLength={300} value={query} onChange={(e) => setQuery(e.target.value)} /></label><ToolButton disabled={busy || !query.trim()} onClick={() => void action({ operation: "read_alerts", query })}>Read up to 10 matching alerts</ToolButton><ul className="space-y-2">{alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)}</ul></div>}
      {status.features?.includes("calendar_events") && <div className="space-y-2"><h3 className="text-sm text-paper">Interview or follow-up event</h3><label className="block text-xs text-ink-400">Title<input className={inputClass} maxLength={200} value={event.title} onChange={(e) => { setReview(null); setEvent({ ...event, title: e.target.value }); }} /></label><div className="grid gap-2 md:grid-cols-2"><label className="text-xs text-ink-400">Starts (your local time)<input type="datetime-local" className={inputClass} value={event.start} onChange={(e) => { setReview(null); setEvent({ ...event, start: e.target.value }); }} /></label><label className="text-xs text-ink-400">Ends (your local time)<input type="datetime-local" className={inputClass} value={event.end} onChange={(e) => { setReview(null); setEvent({ ...event, end: e.target.value }); }} /></label></div><label className="block text-xs text-ink-400">Notes<textarea className={inputClass} maxLength={1000} value={event.description} onChange={(e) => { setReview(null); setEvent({ ...event, description: e.target.value }); }} /></label><label className="block text-xs text-ink-400">Popup reminder before event (minutes)<input type="number" min={0} max={10080} className={inputClass} value={event.reminderMinutes} onChange={(e) => { setReview(null); setEvent({ ...event, reminderMinutes: Number(e.target.value) }); }} /></label><ToolButton disabled={busy || !event.start || !event.end || !event.title.trim()} onClick={() => void reviewEvent()}>Review event & reminder</ToolButton></div>}
      {status.features?.includes("email_drafts") && <div className="space-y-2"><h3 className="text-sm text-paper">Write an unsent email draft</h3><label className="block text-xs text-ink-400">Recipient<input type="email" className={inputClass} maxLength={254} value={draft.to} onChange={(e) => { setReview(null); setDraft({ ...draft, to: e.target.value }); }} /></label><label className="block text-xs text-ink-400">Subject<input className={inputClass} maxLength={200} value={draft.subject} onChange={(e) => { setReview(null); setDraft({ ...draft, subject: e.target.value }); }} /></label><label className="block text-xs text-ink-400">Message<textarea className={inputClass} maxLength={1000} rows={4} value={draft.body} onChange={(e) => { setReview(null); setDraft({ ...draft, body: e.target.value }); }} /></label><ToolButton disabled={busy || !draft.to || !draft.subject.trim() || !draft.body} onClick={() => void action({ operation: "review", action: { type: "email_draft", ...draft } })}>Review draft</ToolButton></div>}
      {review && <div className="rounded-lg border border-brass-400 bg-brass-400/10 p-3"><h3 className="text-sm text-paper">Review before creating in Google</h3>{review.action.type === "calendar_event" ? <p className="whitespace-pre-wrap text-xs text-paper">{review.action.title}{"\n"}{new Date(review.action.start).toLocaleString()} – {new Date(review.action.end).toLocaleString()}{"\n"}Popup reminder: {review.action.reminderMinutes} minutes before{"\n"}{review.action.description}{"\n"}Private event on your primary calendar.</p> : <p className="whitespace-pre-wrap text-xs text-paper">To: {review.action.to}{"\n"}Subject: {review.action.subject}{"\n\n"}{review.action.body}{"\n\n"}Creates an unsent draft.</p>}<div className="mt-2 flex gap-2"><ToolButton disabled={busy} onClick={() => void action({ operation: "approve", approvalId: review.id })}>{review.action.type === "calendar_event" ? "Approve & create event" : "Approve & create unsent draft"}</ToolButton><ToolButton disabled={busy} onClick={() => setReview(null)}>Cancel</ToolButton></div></div>}
      {receipt?.verified && <p className="text-xs text-good">Verified Google receipt: {receipt.providerId} · <a className="underline" href={receipt.link} target="_blank" rel="noopener noreferrer">Open {receipt.type === "email_draft" ? "Gmail Drafts" : "Calendar"}</a></p>}
      <ToolButton disabled={busy} onClick={() => void disconnect()}>Disconnect</ToolButton>
    </div>}
    {message && <p role="status" className="mt-2 text-xs text-brass-300">{message}</p>}{busy && <p role="status" className="text-xs text-ink-400">Waiting for Google…</p>}
  </section>;
}
