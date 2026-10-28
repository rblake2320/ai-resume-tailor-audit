"use client";
import { useEffect, useState } from "react";
import { loadApplications, saveApplications } from "@/lib/storage";
import { ApplicationRecordSchema } from "@/lib/application-record-schema";
import { verifyApplicationPacket, type ApplicationRecord } from "@/lib/applications";
import { ToolButton } from "@/components/ui";

export function AgentWorkspace() {
  const [token, setToken] = useState(""); const [approval, setApproval] = useState("");
  const [consent, setConsent] = useState(false); const [message, setMessage] = useState("");
  const [snapshot, setSnapshot] = useState<{ records: ApplicationRecord[]; revision: string | null; updatedAt: string | null } | null>(null);
  useEffect(() => { const clear = () => { setToken(""); setApproval(""); setSnapshot(null); setConsent(false); setMessage("Session credentials cleared. Server snapshots remain until explicitly replaced."); }; window.addEventListener("resume-foundry:data-cleared", clear); return () => window.removeEventListener("resume-foundry:data-cleared", clear); }, []);
  async function call(operation: string, input: Record<string, unknown>) {
    if (!token || !consent) throw new Error("Enter an agent token and approve packet disclosure first.");
    const response = await fetch(`/api/agent/workspace.${operation}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-resume-foundry-human-approval": approval }, body: JSON.stringify({ input, piiApproved: true }), signal: AbortSignal.timeout(20_000) });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error ?? "Agent workspace unavailable.");
    return body.result;
  }
  async function read() {
    try {
      const data = await call("read", {}); const records = ApplicationRecordSchema.array().max(100).parse(data.records);
      for (const record of records) if (!(await verifyApplicationPacket(record.packet)).valid) throw new Error("Agent workspace contains an invalid packet.");
      setSnapshot({ records, revision: data.revision, updatedAt: data.updatedAt });
      setMessage(`Reviewed agent snapshot: ${records.length} applications. Local tracker: ${loadApplications().length}. Choose the direction explicitly.`);
    } catch (error) { setSnapshot(null); setMessage(error instanceof Error ? error.message : "Workspace read failed."); }
  }
  async function publish() {
    if (!snapshot) { setMessage("Read the current agent snapshot before publishing."); return; }
    try { const records = loadApplications(); const result = await call("publish", { records, expectedRevision: snapshot.revision }); setSnapshot({ records, revision: result.revision, updatedAt: result.updatedAt }); setMessage(`${result.count} reviewed applications published to the audited agent workspace.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Workspace publish failed."); }
  }
  function restore() {
    if (!snapshot || !confirm(`Replace ${loadApplications().length} local application records with the reviewed ${snapshot.records.length}-record agent snapshot?`)) return;
    try { saveApplications(snapshot.records); window.dispatchEvent(new Event("resume-foundry:applications-imported")); setMessage("Reviewed agent snapshot loaded into the local tracker."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Workspace restore failed."); }
  }
  return <section aria-labelledby="agent-workspace-heading" className="rounded-xl border border-ink-700 bg-ink-900/70 p-4"><h2 id="agent-workspace-heading" className="font-display text-xl text-paper">Agent workspace bridge</h2><p className="mt-1 text-xs text-ink-400">Publish reviewed tracker snapshots to the same audited service used by HTTP agents. Publishing stores résumé and packet content on your configured server. Reads and writes require explicit disclosure approval; agents cannot modify this snapshot through MCP. A revision conflict stops replacement.</p><div className="mt-3 flex flex-wrap gap-2"><input className="max-w-full rounded border border-ink-600 bg-ink-950 p-2 text-xs text-paper" type="password" autoComplete="off" aria-label="Agent API token" placeholder="Agent API token" value={token} onChange={(event) => { setToken(event.target.value); setSnapshot(null); }}/><input className="max-w-full rounded border border-ink-600 bg-ink-950 p-2 text-xs text-paper" type="password" autoComplete="off" aria-label="Human approval secret" placeholder="Human approval secret for publishing" value={approval} onChange={(event) => setApproval(event.target.value)}/></div><label className="mt-3 flex gap-2 text-xs text-ink-300"><input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); setSnapshot(null); }}/>I approve sharing the reviewed application packets with this server.</label><div className="mt-3 flex flex-wrap gap-2"><ToolButton onClick={() => void read()}>Review agent snapshot</ToolButton><ToolButton onClick={() => void publish()}>Publish local tracker</ToolButton><ToolButton onClick={restore}>Load reviewed agent snapshot</ToolButton><ToolButton onClick={() => { setToken(""); setApproval(""); setSnapshot(null); setConsent(false); setMessage("Session credentials cleared."); }}>Clear session credentials</ToolButton></div><p role="status" className="mt-2 text-xs text-brass-300">{message}</p></section>;
}
