"use client";

import { useEffect, useState } from "react";
import {
  appendCareerEvent, createCareerLedger, exportEncryptedCareerLedger, importEncryptedCareerLedger,
  currentCareerEvents, type CareerLedger as Ledger,
} from "@/lib/career-ledger";
import { loadCareerLedger, saveCareerLedger } from "@/lib/career-vault";
import { ToolButton } from "@/components/ui";

export function CareerLedger() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"project" | "coursework" | "paid_work" | "volunteering" | "other">("project");
  const [passphrase, setPassphrase] = useState(""); const [status, setStatus] = useState("Loading private career vault…");
  useEffect(() => { void loadCareerLedger().then((saved) => { setLedger(saved); setStatus(saved ? "Career ledger restored from this browser." : "No ledger yet. Create one to start tracking."); }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Vault unavailable.")); }, []);

  async function ensureLedger() {
    const next = ledger ?? createCareerLedger(crypto.randomUUID()); await saveCareerLedger(next); setLedger(next); setStatus("Private career ledger ready.");
  }
  async function add() {
    if (!ledger || !title.trim() || !description.trim()) { setStatus("Create the ledger and enter a title and description first."); return; }
    const next = await appendCareerEvent(ledger, {
      occurredAt: new Date().toISOString(), category, title: title.trim(), description: description.trim(), originalSource: "",
      claimState: "fact", verification: "self_reported", skills: [], measurableResult: "", collaborators: [], context: "",
      confidence: 1, tags: [], occupationCodes: [], evidence: [], visibility: "private", supersedesEventId: null, correctionReason: "",
    });
    await saveCareerLedger(next); setLedger(next); setTitle(""); setDescription(""); setStatus("Entry appended. Earlier history was not rewritten.");
  }
  async function downloadBackup() {
    if (!ledger) return; const backup = await exportEncryptedCareerLedger(ledger, passphrase);
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    link.download = `resume-foundry-career-vault-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
    localStorage.setItem("rf:career-last-backup", new Date().toISOString()); setStatus("Encrypted recovery backup downloaded. Keep the passphrase separately.");
  }
  async function restore(file: File | undefined) {
    if (!file) return;
    try { const restored = await importEncryptedCareerLedger(JSON.parse(await file.text()), passphrase); await saveCareerLedger(restored); setLedger(restored); setStatus("Backup decrypted, integrity-checked, and restored."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Restore failed."); }
  }
  const active = ledger ? currentCareerEvents(ledger) : [];
  const lastBackup = typeof window === "undefined" ? null : localStorage.getItem("rf:career-last-backup");
  return <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-4" aria-labelledby="career-ledger-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="career-ledger-heading" className="font-display text-xl font-semibold text-paper">Career ledger</h2><p className="text-[11px] text-ink-400">Keep projects, work, learning, volunteering, caregiving, and evidence for future uses you cannot predict yet.</p></div>{!ledger && <ToolButton onClick={() => void ensureLedger()}>Create private ledger</ToolButton>}</div>
    <p role="status" className="mt-2 text-xs text-brass-300">{status}</p>
    {ledger && <>
      <div className="mt-3 grid gap-2 md:grid-cols-[10rem_1fr_2fr_auto]"><select aria-label="Entry category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="rounded border border-ink-700 bg-ink-950 p-2 text-xs"><option value="project">Project</option><option value="coursework">Coursework</option><option value="paid_work">Paid work</option><option value="volunteering">Volunteering</option><option value="other">Other</option></select><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What happened?" maxLength={300} className="rounded border border-ink-700 bg-ink-950 p-2 text-xs"/><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What did you do, learn, or accomplish?" maxLength={20000} className="rounded border border-ink-700 bg-ink-950 p-2 text-xs"/><ToolButton onClick={() => void add()}>Append entry</ToolButton></div>
      <div className="mt-3 flex flex-wrap items-center gap-2"><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="Backup passphrase (12+ characters)" aria-label="Career backup passphrase" className="min-w-64 rounded border border-ink-700 bg-ink-950 p-2 text-xs"/><ToolButton onClick={() => void downloadBackup()}>Download encrypted backup</ToolButton><label className="cursor-pointer rounded border border-ink-600 px-3 py-2 text-xs text-paper">Restore backup<input type="file" accept="application/json" className="sr-only" onChange={(event) => void restore(event.target.files?.[0])}/></label></div>
      <p className="mt-2 text-[10px] text-ink-400">{lastBackup ? `Last backup: ${new Date(lastBackup).toLocaleString()}` : "No recovery backup recorded yet. Browser storage alone is not a decades-long backup."}</p>
      <ol className="mt-3 space-y-2">{active.slice().reverse().map((entry) => <li key={entry.id} className="rounded border border-ink-700 bg-ink-950 p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm text-paper">{entry.title}</strong><span className="font-mono text-[10px] text-ink-400">#{entry.sequence} · {entry.verification.replaceAll("_", " ")} · {entry.visibility}</span></div><p className="mt-1 text-xs text-ink-300">{entry.description}</p></li>)}</ol>
      <p className="mt-3 text-[10px] text-ink-500">Every entry is hash-chained. Corrections become linked new events; AI suggestions remain unconfirmed until you approve them.</p>
    </>}
  </section>;
}
