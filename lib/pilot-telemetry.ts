export type PilotEvent = "session_started" | "generation_started" | "generation_completed" | "generation_failed" | "generation_cancelled" | "job_saved" | "job_imported" | "resume_edited" | "export_downloaded" | "print_opened" | "demo_opened";
export type PilotDetails = { durationMs?: number; score?: number; device?: "mobile" | "desktop"; reason?: "provider" | "timeout" | "cancelled"; format?: "docx" | "print"; count?: number };
let enabled = false;
let sessionId = "";

/** Content-free events only. The cloud receiver independently validates every field. */
export function setPilotTelemetryConsent(consented: boolean) {
  enabled = consented;
  if (consented && !sessionId) sessionId = crypto.randomUUID();
  if (!consented) sessionId = "";
}

export function trackPilotEvent(event: PilotEvent, details: PilotDetails = {}) {
  if (!enabled || !sessionId) return;
  // Deliberately rebuild the allowlist: accidental runtime object extras cannot leak.
  const safe = {
    ...(details.durationMs !== undefined ? { durationMs: Math.max(0, Math.min(300_000, Math.round(details.durationMs))) } : {}),
    ...(details.score !== undefined ? { score: Math.max(0, Math.min(100, Math.round(details.score))) } : {}),
    ...(details.count !== undefined ? { count: Math.max(0, Math.min(10_000, Math.round(details.count))) } : {}),
    ...(details.device ? { device: details.device } : {}),
    ...(details.reason ? { reason: details.reason } : {}),
    ...(details.format ? { format: details.format } : {}),
  };
  void fetch("/api/pilot/events", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, sessionId, details: safe }), keepalive: true,
  }).catch(() => undefined); // Analytics failure never interrupts the candidate's work.
}
