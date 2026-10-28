"use client";
import { useRef, useState } from "react";
import type { ApplicationRecord } from "@/lib/applications";
import type { ApprovalReceipt, SubmissionPreview } from "@/lib/submission-connectors";
import { ToolButton } from "@/components/ui";
import { canonicalJson } from "@/lib/canonical-json";

const inputClass = "w-full rounded border border-ink-600 bg-ink-950 p-2 text-xs text-paper";
export function OfficialSubmission({ record, onClose }: { record: ApplicationRecord; onClose: () => void }) {
  const [provider, setProvider] = useState<"greenhouse" | "lever">("greenhouse");
  const [account, setAccount] = useState(""); const [jobId, setJobId] = useState(""); const [required, setRequired] = useState("name,email");
  const [fields, setFields] = useState('{"first_name":"","last_name":"","name":"","email":""}');
  const [secret, setSecret] = useState(""); const [reviewed, setReviewed] = useState(false); const [preview, setPreview] = useState<SubmissionPreview | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [attempted, setAttempted] = useState(false);
  const executing = useRef(false);
  async function call(path: string, body: unknown) {
    const response = await fetch(`/api/submissions/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-resume-foundry-human-approval": secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Submission workflow failed."); return data;
  }
  async function prepare() {
    setBusy(true); setPreview(null); setReviewed(false);
    try {
      const target = provider === "greenhouse" ? { provider, boardToken: account, jobId } : { provider, site: account, postingId: jobId, requiredFields: required.split(",").map((field) => field.trim()).filter(Boolean) };
      const received = await call("preview", { record: { packet: record.packet, state: record.state }, target, fields: JSON.parse(fields) });
      const expectedDestination = provider === "greenhouse" ? `https://boards.greenhouse.io/${account}/jobs/${jobId}` : `https://jobs.lever.co/${account}/${jobId}`;
      if (received.provider !== provider || received.applicationId !== record.packet.id || received.packetChecksum !== record.packet.checksums.packet || received.destination !== expectedDestination || !Array.isArray(received.personalDataCategories) || received.personalDataCategories.some((category: unknown) => typeof category !== "string") || !received.fields || typeof received.fields !== "object" || Array.isArray(received.fields) || received.fields.resume_text !== record.packet.tailoredResult.tailored_resume_markdown || received.fields.cover_letter_text !== record.packet.tailoredResult.cover_letter_markdown) throw new Error("Preview response did not match the frozen packet and selected destination.");
      setPreview(received); setMessage("Review the exact destination and all fields below before approving.");
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Preview failed."); }
    finally { setBusy(false); }
  }
  async function execute() {
    if (!preview || !reviewed || attempted || executing.current) return;
    executing.current = true;
    setBusy(true); setAttempted(true);
    try {
      const receipt: ApprovalReceipt = await call("approve", preview);
      if (!receipt || canonicalJson(receipt.preview) !== canonicalJson(preview) || typeof receipt.signature !== "string" || !receipt.signature || typeof receipt.nonce !== "string" || !receipt.nonce || !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= Date.now()) throw new Error("Approval response did not match the exact reviewed preview.");
      const result = await call("execute", { receipt, packet: record.packet });
      if (result.accepted !== true || result.provider !== preview.provider || result.applicationId !== preview.applicationId || !Number.isInteger(result.status) || result.status < 200 || result.status > 299 || (preview.provider === "lever" && (typeof result.providerApplicationId !== "string" || !result.providerApplicationId))) throw new Error("Provider response did not contain a valid acceptance receipt.");
      setMessage(`Provider accepted the request (HTTP ${result.status})${result.providerApplicationId ? ` · provider application receipt ${result.providerApplicationId}` : ""}. Check the employer's receipt before marking the application submitted. This panel will not retry.`);
    }
    catch (error) { setMessage(`${error instanceof Error ? error.message : "Submission failed."} No automatic retry. Check the provider and durable attempt record before another attempt.`); }
    finally { setBusy(false); }
  }
  const invalidate = () => { setPreview(null); setReviewed(false); };
  return <div role="dialog" aria-modal="true" aria-labelledby="official-submission-title" className="fixed inset-0 z-50 overflow-y-auto bg-ink-950/95 p-4"><div className="mx-auto max-w-3xl space-y-3 rounded-xl border border-ink-600 bg-ink-900 p-5"><h2 id="official-submission-title" className="font-display text-2xl text-paper">Authorized employer submission</h2><p className="text-xs text-ink-300">Requires an employer-authorized API account and a server allowlist. For ordinary job applications, use guided handoff. This action transmits the reviewed fields to the employer; it is not a demo.</p><p className="text-sm text-paper">{record.packet.jobSnapshot.title} @ {record.packet.jobSnapshot.company} · packet v{record.packet.version}</p><label className="block text-xs text-ink-400">Provider<select aria-label="Submission provider" className={inputClass} value={provider} disabled={attempted} onChange={(event) => { invalidate(); setProvider(event.target.value as typeof provider); }}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></label><label className="block text-xs text-ink-400">Authorized board/site<input className={inputClass} value={account} disabled={attempted} onChange={(event) => { invalidate(); setAccount(event.target.value); }}/></label><label className="block text-xs text-ink-400">Job/posting identifier<input className={inputClass} value={jobId} disabled={attempted} onChange={(event) => { invalidate(); setJobId(event.target.value); }}/></label>{provider === "lever" && <label className="block text-xs text-ink-400">Employer-supplied required fields (comma separated)<input className={inputClass} value={required} disabled={attempted} onChange={(event) => { invalidate(); setRequired(event.target.value); }}/></label>}<label className="block text-xs text-ink-400">Applicant and screening fields (JSON)<textarea aria-label="Applicant and screening fields (JSON)" rows={5} className={inputClass} value={fields} disabled={attempted} onChange={(event) => { invalidate(); setFields(event.target.value); }}/></label><p className="text-xs text-ink-400">Résumé and cover-letter text are taken from the frozen packet. Provider-specific attachments and custom questions must satisfy the employer's API contract.</p><label className="block text-xs text-ink-400">Human approval secret<input type="password" autoComplete="off" className={inputClass} value={secret} onChange={(event) => { invalidate(); setSecret(event.target.value); }}/></label><ToolButton disabled={busy || attempted} onClick={() => void prepare()}>Build exact submission preview</ToolButton>{preview && <><p className="break-all text-sm text-brass-300">Destination: {preview.destination}</p><p className="text-xs text-ink-300">Personal data: {preview.personalDataCategories.join(", ")}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-3 text-xs text-paper">{JSON.stringify(preview.fields, null, 2)}</pre><label className="flex gap-2 text-xs text-paper"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)}/>I reviewed this exact destination and every outgoing field and authorize one employer submission.</label><ToolButton disabled={busy || !reviewed || attempted} onClick={() => void execute()}>Approve and submit once</ToolButton></>}<p role="status" className="text-xs text-brass-300">{message}</p><ToolButton disabled={busy} onClick={onClose}>Close submission review</ToolButton></div></div>;
}
