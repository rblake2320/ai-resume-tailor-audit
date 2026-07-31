"use client";

import { useMemo, useState } from "react";
import type { ApplicationRecord } from "@/lib/applications";
import { buildHandoffReview, validHandoffDestination } from "@/lib/handoff";
import { CopyButton, ToolButton } from "@/components/ui";

export function GuidedHandoff({ record, onClose }: { record: ApplicationRecord; onClose: () => void }) {
  const review = useMemo(() => buildHandoffReview(record), [record]);
  const [consents, setConsents] = useState<Set<string>>(new Set());
  const ready = review.requiredConsents.every((consent) => consents.has(consent)) && validHandoffDestination(review.destination);
  const toggle = (value: string) => setConsents((current) => { const next = new Set(current); if (next.has(value)) next.delete(value); else next.add(value); return next; });
  return <div role="dialog" aria-modal="true" aria-labelledby="handoff-title" className="fixed inset-0 z-50 overflow-y-auto bg-ink-950/90 p-4"><div className="mx-auto max-w-3xl rounded-xl border border-brass-400/40 bg-ink-900 p-5 shadow-2xl">
    <h2 id="handoff-title" className="font-display text-2xl text-paper">Final guided-handoff review</h2><p className="mt-1 text-xs text-ink-400">Foundry will open the official page. It will not fill, manipulate, or submit the site.</p>
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><Field label="Company" value={review.company} /><Field label="Role" value={review.role} /><Field label="Destination" value={review.destination || "Missing"} /><Field label="Submission method" value="Manual guided handoff" /><Field label="Packet version" value={`v${review.packetVersion}`} /><Field label="Résumé version" value={review.resumeVersion} /><Field label="Cover-letter version" value={review.coverLetterVersion} /><Field label="Personal data disclosed" value={review.personalDataCategories.join(", ") || "No standard contact identifiers detected"} /></dl>
    <div className="mt-4 grid gap-3 md:grid-cols-2"><Document title="Tailored résumé" text={record.packet.tailoredResult.tailored_resume_markdown} /><Document title="Cover letter" text={record.packet.tailoredResult.cover_letter_markdown} /></div>
    <div className="mt-4 rounded-lg border border-ink-700 p-3"><h3 className="text-xs font-semibold text-paper">Screening answers</h3>{Object.keys(review.answers).length ? Object.entries(review.answers).map(([question, answer]) => <div key={question} className="mt-2 flex items-start gap-2 text-xs"><div className="min-w-0 flex-1"><span className="block text-ink-400">{question}</span><span className="text-ink-100">{answer}</span></div><CopyButton text={answer} /></div>) : <p className="mt-1 text-xs text-ink-400">No screening answers stored in this packet.</p>}</div>
    <div className="mt-4 space-y-2 text-xs"><Consent checked={consents.has("reviewed-packet")} onChange={() => toggle("reviewed-packet")} label="I reviewed the exact résumé, cover letter, and answers in this packet." /><Consent checked={consents.has("reviewed-personal-data")} onChange={() => toggle("reviewed-personal-data")} label="I reviewed the personal-data categories that may be disclosed." /><Consent checked={consents.has("understands-manual-handoff")} onChange={() => toggle("understands-manual-handoff")} label="I understand Foundry only opens the destination; I remain responsible for reviewing and submitting there." /></div>
    {!review.destination && <p role="alert" className="mt-3 text-xs text-bad">This packet has no application URL. Add an official destination before handoff.</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2"><ToolButton onClick={onClose}>Cancel</ToolButton><button type="button" disabled={!ready} onClick={() => window.open(review.destination, "_blank", "noopener,noreferrer")} className="rounded-lg border border-brass-400/50 bg-brass-400/10 px-4 py-2 text-xs font-semibold text-brass-300 disabled:opacity-40">Open official application page</button></div>
  </div></div>;
}

function Field({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-ink-950 p-2"><dt className="font-mono text-[10px] text-ink-400">{label}</dt><dd className="break-all text-ink-100">{value}</dd></div>; }
function Document({ title, text }: { title: string; text: string }) { return <div className="rounded-lg border border-ink-700 p-3"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-paper">{title}</h3><CopyButton text={text} /></div><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-ink-300">{text}</pre></div>; }
function Consent({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5" /><span>{label}</span></label>; }
