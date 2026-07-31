"use client";

import { useEffect, useState } from "react";
import {
  appendCareerEvent, createCareerLedger, exportEncryptedCareerLedger, importEncryptedCareerLedger,
  currentCareerEvents, deleteCareerEvent, type CareerLedger as Ledger,
} from "@/lib/career-ledger";
import { deleteCareerLedger, hasCareerLedger, loadCareerLedger, migrateLegacyPlaintextCareerLedger, saveCareerLedger } from "@/lib/career-vault";
import { ToolButton } from "@/components/ui";

export function CareerLedger() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"project" | "coursework" | "paid_work" | "volunteering" | "other">("project");
  const [passphrase, setPassphrase] = useState(""); const [status, setStatus] = useState("Checking encrypted career vault…");
  const [legacyDetected, setLegacyDetected] = useState(false);
  const [vaultExists, setVaultExists] = useState(false); const [ageBand, setAgeBand] = useState<"minor" | "adult" | "unspecified">("unspecified");
  useEffect(() => { void hasCareerLedger().then((exists) => { setVaultExists(exists); setStatus(exists ? "Encrypted ledger found. Enter its passphrase to unlock." : "No ledger yet. Choose a passphrase to create one."); }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Vault unavailable.")); }, []);

  async function ensureLedger() {
    try { const next = ledger ?? createCareerLedger(crypto.randomUUID(), new Date(), ageBand); await saveCareerLedger(next, passphrase); setLedger(next); setVaultExists(true); setStatus("Encrypted private career ledger ready."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Vault creation failed."); }
  }
  async function unlock() {
    try { const saved = await loadCareerLedger(passphrase); setLedger(saved); setStatus(saved ? "Career ledger decrypted and integrity-checked." : "No ledger found."); }
    catch (error) { const message = error instanceof Error ? error.message : "Unlock failed."; setLegacyDetected(message.includes("legacy plaintext")); setStatus(message); }
  }
  async function migrateLegacy() {
    try { const saved = await migrateLegacyPlaintextCareerLedger(passphrase); setLedger(saved); setVaultExists(true); setLegacyDetected(false); setStatus("Legacy vault explicitly migrated, encrypted, and integrity-checked."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Legacy migration failed."); }
  }
  async function add() {
    if (!ledger || !title.trim() || !description.trim()) { setStatus("Create the ledger and enter a title and description first."); return; }
    const next = await appendCareerEvent(ledger, {
      occurredAt: new Date().toISOString(), category, title: title.trim(), description: description.trim(), originalSource: "",
      claimState: "fact", verification: "self_reported", skills: [], measurableResult: "", collaborators: [], context: "",
      confidence: 1, tags: [], occupationCodes: [], evidence: [], visibility: "private", supersedesEventId: null, correctionReason: "",
    });
    await saveCareerLedger(next, passphrase); setLedger(next); setTitle(""); setDescription(""); setStatus("Entry appended and encrypted. Earlier history was not rewritten.");
  }
  async function downloadBackup() {
    if (!ledger) return; const backup = await exportEncryptedCareerLedger(ledger, passphrase);
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    link.download = `resume-foundry-career-vault-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
    localStorage.setItem("rf:career-last-backup", new Date().toISOString()); setStatus("Encrypted recovery backup downloaded. Keep the passphrase separately.");
  }
  async function restore(file: File | undefined) {
    if (!file) return;
    try { const restored = await importEncryptedCareerLedger(JSON.parse(await file.text()), passphrase); await saveCareerLedger(restored, passphrase); setLedger(restored); setVaultExists(true); setStatus("Backup decrypted, integrity-checked, and restored."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Restore failed."); }
  }
  async function removeEvent(eventId: string) { if (!ledger || !confirm("Permanently erase this event's content? A non-content deletion receipt remains.")) return; const next = await deleteCareerEvent(ledger, eventId, "Owner-requested item deletion"); await saveCareerLedger(next, passphrase); setLedger(next); setStatus("Event content erased; deletion receipt retained."); }
  async function deleteAccountData() { if (!confirm("Delete the entire encrypted Career Ledger from this browser? Download a backup first if needed.")) return; await deleteCareerLedger(); setLedger(null); setVaultExists(false); setStatus("Career Ledger deleted from this browser."); }
  const active = ledger ? currentCareerEvents(ledger) : [];
  const lastBackup = typeof window === "undefined" ? null : localStorage.getItem("rf:career-last-backup");
  return <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-4" aria-labelledby="career-ledger-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="career-ledger-heading" className="font-display text-xl font-semibold text-paper">Career ledger</h2><p className="text-[11px] text-ink-400">Keep projects, work, learning, volunteering, caregiving, and evidence for future uses you cannot predict yet.</p></div></div>
    <p role="status" className="mt-2 text-xs text-brass-300">{status}</p>
    {!ledger && <div className="mt-3 flex flex-wrap items-center gap-2"><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="Vault passphrase (12+ characters)" aria-label="Career vault passphrase" className="min-w-0 w-full rounded border border-ink-700 bg-ink-950 p-2 text-xs sm:w-auto sm:min-w-64"/>{!vaultExists && <select aria-label="Age privacy setting" value={ageBand} onChange={(event) => setAgeBand(event.target.value as typeof ageBand)} className="max-w-full rounded border border-ink-700 bg-ink-950 p-2 text-xs"><option value="unspecified">Age not specified</option><option value="minor">Under age of majority</option><option value="adult">Adult</option></select>}<ToolButton onClick={() => void (vaultExists ? unlock() : ensureLedger())}>{vaultExists ? "Unlock ledger" : "Create encrypted ledger"}</ToolButton>{legacyDetected && <ToolButton onClick={() => void migrateLegacy()}>Explicitly migrate legacy vault</ToolButton>}<label className="cursor-pointer rounded border border-ink-600 px-3 py-2 text-xs text-paper">Restore encrypted backup<input type="file" accept="application/json" className="sr-only" onChange={(event) => void restore(event.target.files?.[0])}/></label></div>}
    {ledger && <>
      <div className="mt-3 grid gap-2 md:grid-cols-[10rem_1fr_2fr_auto]"><select aria-label="Entry category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="rounded border border-ink-700 bg-ink-950 p-2 text-xs"><option value="project">Project</option><option value="coursework">Coursework</option><option value="paid_work">Paid work</option><option value="volunteering">Volunteering</option><option value="other">Other</option></select><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What happened?" maxLength={300} className="rounded border border-ink-700 bg-ink-950 p-2 text-xs"/><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What did you do, learn, or accomplish?" maxLength={20000} className="rounded border border-ink-700 bg-ink-950 p-2 text-xs"/><ToolButton onClick={() => void add()}>Append entry</ToolButton></div>
      {ledger.privacy.ageBand === "minor" && <p className="mt-3 rounded border border-amber-600/40 p-2 text-xs text-amber-300">Minor privacy mode: private by default, no public profile, optional guardian assistance does not transfer ownership. Control review due {ledger.privacy.ageOfMajorityReviewDueAt ? new Date(ledger.privacy.ageOfMajorityReviewDueAt).toLocaleDateString() : "when adulthood is reached"}.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2"><ToolButton onClick={() => void downloadBackup()}>Download encrypted backup</ToolButton><label className="cursor-pointer rounded border border-ink-600 px-3 py-2 text-xs text-paper">Restore backup<input type="file" accept="application/json" className="sr-only" onChange={(event) => void restore(event.target.files?.[0])}/></label><ToolButton onClick={() => void deleteAccountData()}>Delete entire ledger</ToolButton></div>
      <p className="mt-2 text-[10px] text-ink-400">{lastBackup ? `Last backup: ${new Date(lastBackup).toLocaleString()}` : "No recovery backup recorded yet. Browser storage alone is not a decades-long backup."}</p>
      <ol className="mt-3 space-y-2">{active.slice().reverse().map((entry) => <li key={entry.id} className="rounded border border-ink-700 bg-ink-950 p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm text-paper">{entry.title}</strong><span className="font-mono text-[10px] text-ink-400">#{entry.sequence} · {entry.verification.replaceAll("_", " ")} · {entry.visibility}</span></div><p className="mt-1 text-xs text-ink-300">{entry.description}</p><button type="button" onClick={() => void removeEvent(entry.id)} className="mt-2 text-[10px] text-red-300 underline">Erase this item</button></li>)}</ol>
      <p className="mt-3 text-[10px] text-ink-500">Every entry is hash-chained. Corrections become linked new events; AI suggestions remain unconfirmed until you approve them.</p>
    </>}
  </section>;
}
