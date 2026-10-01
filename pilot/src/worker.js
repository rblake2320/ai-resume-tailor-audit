import { adminMarkup, adminScript } from "./dashboard.js";
const VERSION = "2026-10-01-v1";
const COOKIE = "__Host-rf-pilot";
const ADMIN_COOKIE = "__Host-rf-pilot-admin";
const DAY = 86400000;
const EVENTS = new Set(["session_started", "demo_opened", "generation_started", "generation_completed", "generation_failed", "generation_cancelled", "job_saved", "job_imported", "resume_edited", "export_downloaded", "print_opened"]);
const REASONS = new Set(["network", "timeout", "validation", "cancelled", "provider", "storage", "unknown"]);
const enc = new TextEncoder();
class Denied extends Error { constructor(status, message) { super(message); this.status = status; } }
function deny(status, message) { throw new Denied(status, message); }
function json(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } }); }
function exact(value, keys) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) deny(400, "Unexpected request fields."); }
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function uuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function oneOf(value, values) { return typeof value === "string" && values.includes(value); }
function day(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }
function b64(bytes) { let text = ""; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function unb64(text) { const raw = atob(text.replaceAll("-", "+").replaceAll("_", "/")); return Uint8Array.from(raw, (char) => char.charCodeAt(0)); }
async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))].map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function key(secret) { if (typeof secret !== "string" || secret.length < 32) deny(503, "Pilot authentication is not configured."); return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
async function sign(payload, secret) { const encoded = b64(enc.encode(JSON.stringify(payload))); return `${encoded}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(encoded))))}`; }
async function unpack(token, secret) {
  if (!token || token.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payload, signature] = token.split(".");
  try { if (!await crypto.subtle.verify("HMAC", await key(secret), unb64(signature), enc.encode(payload))) return null; const value = JSON.parse(new TextDecoder().decode(unb64(payload))); return uuid(value.id) && oneOf(value.role, ["tester", "admin"]) && integer(value.exp, 0, Number.MAX_SAFE_INTEGER) ? value : null; } catch (error) { if (error instanceof Denied) throw error; return null; }
}
function cookie(request, name) { const entries = (request.headers.get("cookie") ?? "").split(";").map((item) => item.trim().split("=")); return entries.find(([key]) => key === name)?.[1]; }
function setCookie(name, token, seconds) { return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`; }
function csrf(request) { const site = request.headers.get("sec-fetch-site"); if (request.headers.get("origin") !== new URL(request.url).origin || (site !== null && site !== "same-origin")) deny(403, "Same-origin request required."); }
async function bytes(request, max) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { await request.body?.cancel().catch(() => undefined); deny(413, "Request is too large."); }
  if (!request.body) deny(400, "Request body required.");
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > max) { await reader.cancel().catch(() => undefined); deny(413, "Request is too large."); } chunks.push(item.value); } } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; } return buffer;
}
async function body(request, max = 4096) { if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") deny(415, "JSON required."); try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytes(request, max))); } catch (error) { if (error instanceof Denied) throw error; deny(400, "Invalid JSON."); } }
async function session(request, env, role = "tester") {
  const token = await unpack(cookie(request, role === "admin" ? ADMIN_COOKIE : COOKIE), env.SESSION_SECRET);
  if (!token || token.role !== role || token.exp <= Date.now()) return null;
  const row = await env.DB.prepare("SELECT s.id,s.participant_id,s.role,s.expires_at,p.consent,p.consent_version FROM sessions s LEFT JOIN participants p ON p.id=s.participant_id WHERE s.id=? AND s.role=? AND s.expires_at>? AND s.expires_at=?").bind(token.id, role, Date.now(), token.exp).first();
  if (!row) return null;
  if (role === "tester") { const invite = await env.DB.prepare("SELECT id FROM invites WHERE id=? AND enabled=1 AND expires_at>?").bind(row.participant_id, Date.now()).first(); if (!invite) return null; }
  return row;
}
async function admission(env, participant, kind, limit, needsConsent = false, globalLimit = null) {
  const id = crypto.randomUUID(); const today = day(); const now = Date.now();
  const statement = env.DB.prepare("INSERT INTO admissions(id,participant_id,kind,day,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM admissions WHERE kind=? AND day=? AND participant_id=?)<? AND (? IS NULL OR (SELECT COUNT(*) FROM admissions WHERE kind=? AND day=?)<?) AND (?=0 OR EXISTS(SELECT 1 FROM participants WHERE id=? AND consent=1))").bind(id, participant, kind, today, now, kind, today, participant, limit, globalLimit, kind, today, globalLimit, needsConsent ? 1 : 0, participant);
  return { id, now, statement };
}
async function admitOnly(env, participant, kind, limit, globalLimit) { const claim = await admission(env, participant, kind, limit, false, globalLimit); const result = await claim.statement.run(); if (result.meta.changes !== 1) deny(429, "Daily pilot allowance reached."); return claim; }
async function login(request, env, role) {
  csrf(request); const input = await body(request, 1024); exact(input, [role === "admin" ? "secret" : "code"]);
  await key(env.SESSION_SECRET);
  await admitOnly(env, `login-${role}`, "login", 1000, 2000);
  let participant = null;
  if (role === "admin") {
    if (typeof env.ADMIN_SECRET !== "string" || env.ADMIN_SECRET.length < 32) deny(503, "Pilot administration is not configured.");
    if (typeof input.secret !== "string" || input.secret.length > 256) deny(403, "Invalid credential.");
    const expected = await digest(env.ADMIN_SECRET); const supplied = await digest(input.secret); let different = 0; for (let i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ supplied.charCodeAt(i); if (different) deny(403, "Invalid credential.");
  } else {
    if (typeof input.code !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(input.code)) deny(403, "Invalid invite.");
    const invite = await env.DB.prepare("SELECT id FROM invites WHERE code_hash=? AND enabled=1 AND expires_at>?").bind(await digest(input.code), Date.now()).first();
    if (!invite) deny(403, "Invalid invite."); participant = invite.id;
    await env.DB.prepare("INSERT OR IGNORE INTO participants(id,consent,created_at) VALUES(?,0,?)").bind(participant, Date.now()).run();
  }
  const id = crypto.randomUUID(); const seconds = role === "admin" ? 3600 : 8 * 3600; const exp = Date.now() + seconds * 1000;
  await env.DB.prepare("INSERT INTO sessions(id,participant_id,role,expires_at) VALUES(?,?,?,?)").bind(id, participant, role, exp).run();
  return json({ authenticated: true }, 200, { "set-cookie": setCookie(role === "admin" ? ADMIN_COOKIE : COOKIE, await sign({ id, role, exp }, env.SESSION_SECRET), seconds) });
}
function validateEvent(input) {
  exact(input, ["event", "sessionId", "details"]);
  if (!EVENTS.has(input.event) || !uuid(input.sessionId)) deny(400, "Unsupported event.");
  const details = input.details ?? {}; exact(details, ["durationMs", "score", "device", "reason", "format", "count"]);
  if ((details.durationMs !== undefined && !integer(details.durationMs, 0, 300000)) || (details.score !== undefined && !integer(details.score, 0, 100)) || (details.count !== undefined && !integer(details.count, 0, 10000)) || (details.device !== undefined && !oneOf(details.device, ["mobile", "desktop"])) || (details.reason !== undefined && !REASONS.has(details.reason)) || (details.format !== undefined && !oneOf(details.format, ["docx", "print"]))) deny(400, "Unsupported event details.");
  return details;
}
function validateFeedback(input) {
  exact(input, ["rating", "accuracy", "goal", "outcome", "comment", "reviewed"]);
  if (!integer(input.rating, 1, 5) || !oneOf(input.accuracy, ["accurate", "minor_issues", "major_issues", "not_tested"]) || !oneOf(input.goal, ["tailor_resume", "cover_letter", "job_import", "tracking", "other"]) || !oneOf(input.outcome, ["not_applied", "applied", "interview", "offer", "not_tested"]) || typeof input.comment !== "string" || input.comment.length > 2000 || input.reviewed !== true) deny(400, "Review the supported feedback fields before submission.");
  // Free text is expressly approved, but obvious identifiers are rejected to
  // reduce accidental disclosure; this is not a comprehensive PII detector.
  if (/https?:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d{3}[- ]\d{2}[- ]\d{4}\b/.test(input.comment)) deny(400, "Remove links, email addresses and identifiers from feedback.");
}
function limits(env) { const number = (value, fallback, max) => { const n = value === undefined ? fallback : Number(value); if (!integer(n, 1, max)) deny(503, "Pilot budget is not configured safely."); return n; }; return { tester: number(env.PILOT_AI_PER_TESTER_PER_DAY, 3, 10), global: number(env.PILOT_AI_GLOBAL_PER_DAY, 10, 100) }; }
function aiEnabled(env) { return env.PILOT_AI_ENABLED === "true" && env.PILOT_AI_PROVIDER === "ollama"; }
export function allowedProxy(path, method) {
  if (method === "GET" && path === "/api/capabilities") return true;
  if (method === "GET" || method === "HEAD") return ["/", "/about", "/how-it-works", "/favicon.ico"].includes(path) || /^\/_next\/static\/[A-Za-z0-9_./-]+$/.test(path);
  return method === "POST" && ["/api/tailor", "/api/fetch-job", "/api/parse-resume", "/api/jobs/import", "/api/labor-market/onet", "/api/labor-market/bls-series"].includes(path);
}
function safeOrigin(env) { let origin; try { origin = new URL(env.ORIGIN_URL); } catch { deny(503, "Pilot origin is not configured."); } if (origin.protocol !== "https:" || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(origin.hostname) || origin.port || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || typeof env.ORIGIN_SECRET !== "string" || env.ORIGIN_SECRET.length < 32) deny(503, "Pilot origin is not configured safely."); return origin; }
async function proxy(request, env, tester) {
  const url = new URL(request.url); const path = url.pathname;
  if (!allowedProxy(path, request.method)) deny(403, "This operation is unavailable in the tester pilot.");
  const origin = safeOrigin(env);
  if (request.method === "POST") csrf(request);
  let payload;
  if (request.method === "POST") {
    if (path === "/api/tailor" && !aiEnabled(env)) deny(403, "Generation is disabled in this pilot.");
    payload = await bytes(request, path === "/api/parse-resume" ? 10 * 1024 * 1024 + 65536 : path === "/api/tailor" ? 256000 : path === "/api/jobs/import" ? 1100000 : 8192);
    if (path === "/api/tailor") { const budget = limits(env); await admitOnly(env, tester.participant_id, "ai", budget.tester, budget.global); }
  }
  const headers = new Headers();
  for (const name of ["content-type", "accept", "accept-language", "rsc", "next-router-state-tree", "next-router-prefetch", "next-url"]) { const value = request.headers.get(name); if (value && value.length <= 8192) headers.set(name, value); }
  headers.set("x-resume-pilot-origin", env.ORIGIN_SECRET);
  headers.set("x-resume-pilot-participant", tester.participant_id);
  headers.set("user-agent", "ResumeFoundryPrivatePilotGateway");
  const target = new URL(path + url.search, origin);
  const init = { method: request.method, headers, body: payload, redirect: "manual", signal: AbortSignal.timeout(path === "/api/tailor" ? 180000 : 30000) };
  const response = await fetch(target, init);
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel().catch(() => undefined); deny(502, "Unexpected origin redirect."); }
  const resultHeaders = new Headers(response.headers);
  resultHeaders.delete("set-cookie"); resultHeaders.delete("access-control-allow-origin"); resultHeaders.delete("access-control-allow-credentials"); resultHeaders.delete("server");
  resultHeaders.set("cache-control", "no-store"); resultHeaders.set("referrer-policy", "no-referrer"); resultHeaders.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, headers: resultHeaders });
}
function page(kind) {
  const nonce = crypto.randomUUID(); const admin = kind === "admin"; const field = admin ? "secret" : "code";
  const title = admin ? "Private pilot owner dashboard" : "Resume Foundry private pilot";
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style nonce="${nonce}">body{background:#121511;color:#ede9df;font:16px system-ui;max-width:48rem;margin:4rem auto;padding:1rem}input,button{font:inherit;padding:.7rem;margin:.4rem 0}input{width:90%}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#d9bc7c}.cards{display:flex;flex-wrap:wrap;gap:1rem}article{background:#22281e;padding:1rem;border-radius:.5rem;margin:.7rem 0}.cards strong{font-size:1.7rem}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.5rem;border-bottom:1px solid #454a3e}</style><main><h1>${title}</h1><p>${admin ? "Use the separate owner secret to view opted-in, bounded tester feedback. Never paste applicant data here." : "Enter your private invite code. Do not put codes in a URL. Feedback and usage collection stay off until you explicitly opt in inside the app. Invite hashes, expiring authentication sessions and daily abuse/budget counts are necessary operational records; no IP address or browser user-agent is stored."}</p><form id="login"><label>${admin ? "Owner secret" : "Invite code"}<input id="credential" type="password" autocomplete="off" required maxlength="128"></label><button>Enter</button></form><p id="status" role="status"></p>${admin ? adminMarkup : ""}</main><script nonce="${nonce}">const status=document.querySelector('#status');document.querySelector('#login').onsubmit=async e=>{e.preventDefault();const response=await fetch('${admin ? "/api/pilot/admin/login" : "/api/pilot/login"}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({${field}:document.querySelector('#credential').value})});document.querySelector('#credential').value='';const data=await response.json();if(!response.ok){status.textContent=data.error;return}${admin ? "document.querySelector('#login').hidden=true;await refresh();" : "location.replace('/');"}};${admin ? adminScript : ""}</script></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
}
async function exportData(env, url) {
  const cutoff = Date.now() - 30 * DAY;
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (!integer(offset, 0, 150000)) deny(400, "Invalid export offset.");
  const [events, feedback, participants, counts, coverage, feedbackSummary] = await Promise.all([
    env.DB.prepare("SELECT e.participant_id,e.name,e.session_id,e.details_json,e.created_at FROM events e JOIN participants p ON p.id=e.participant_id WHERE p.consent=1 AND e.created_at>=? ORDER BY e.created_at,e.id LIMIT 1001 OFFSET ?").bind(cutoff,offset).all(),
    env.DB.prepare("SELECT f.participant_id,f.rating,f.accuracy,f.goal,f.outcome,f.comment,f.created_at FROM feedback f JOIN participants p ON p.id=f.participant_id WHERE p.consent=1 AND f.created_at>=? ORDER BY f.created_at,f.id LIMIT 1001 OFFSET ?").bind(cutoff,offset).all(),
    env.DB.prepare("SELECT id,consent,consent_version,consented_at FROM participants LIMIT 1000").all(),
    env.DB.prepare("SELECT e.name,COUNT(*) AS count FROM events e JOIN participants p ON p.id=e.participant_id WHERE p.consent=1 AND e.created_at>=? GROUP BY e.name").bind(cutoff).all(),
    env.DB.prepare("SELECT MIN(created_at) AS first,MAX(created_at) AS last FROM (SELECT e.created_at FROM events e JOIN participants p ON p.id=e.participant_id WHERE p.consent=1 AND e.created_at>=? UNION ALL SELECT f.created_at FROM feedback f JOIN participants p ON p.id=f.participant_id WHERE p.consent=1 AND f.created_at>=?)").bind(cutoff,cutoff).first(),
    env.DB.prepare("SELECT COUNT(*) AS count,AVG(f.rating) AS averageRating FROM feedback f JOIN participants p ON p.id=f.participant_id WHERE p.consent=1 AND f.created_at>=?").bind(cutoff).first(),
  ]);
  return { feedbackSummary, exportedAt: new Date().toISOString(), retentionDays: 30, offset, nextOffset: events.results.length>1000 || feedback.results.length>1000 ? offset+1000 : null, coverage: { first: coverage.first === null ? null : new Date(coverage.first).toISOString(), last: coverage.last === null ? null : new Date(coverage.last).toISOString() }, eventCounts: Object.fromEntries(counts.results.map(row=>[row.name,row.count])), participants: participants.results, events: events.results.slice(0,1000).map(({ details_json,...row })=>({...row,details:JSON.parse(details_json)})), feedback: feedback.results.slice(0,1000) };
}
export async function cleanup(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE created_at<?").bind(now - 30 * DAY),
    env.DB.prepare("DELETE FROM feedback WHERE created_at<?").bind(now - 30 * DAY),
    env.DB.prepare("DELETE FROM admissions WHERE created_at<?").bind(now - 2 * DAY),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
  ]);
}
export async function handle(request, env) {
  const url = new URL(request.url); const path = url.pathname;
  if (url.searchParams.has("code") || url.searchParams.has("invite")) deny(400, "Invite codes must never appear in URLs.");
  if (request.method === "GET" && path === "/pilot/login") return page("tester");
  if (request.method === "GET" && path === "/pilot/admin") return page("admin");
  if (request.method === "POST" && path === "/api/pilot/login") return login(request, env, "tester");
  if (request.method === "POST" && path === "/api/pilot/admin/login") return login(request, env, "admin");
  if (path.startsWith("/api/pilot/admin/")) {
    const admin = await session(request, env, "admin"); if (!admin) deny(403, "Owner authentication required.");
    if (request.method === "GET" && path === "/api/pilot/admin/export") return json(await exportData(env, url));
    if (request.method === "POST" && path === "/api/pilot/admin/logout") { csrf(request); await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(admin.id).run(); return json({ authenticated: false }, 200, { "set-cookie": setCookie(ADMIN_COOKIE, "", 0) }); }
    deny(404, "Unknown pilot operation.");
  }
  const tester = await session(request, env);
  if (!tester) { if (request.method === "GET" && !path.startsWith("/api/")) return Response.redirect(new URL("/pilot/login", url), 302); deny(401, "Private invite session required."); }
  if (path.startsWith("/api/pilot/")) {
    if (request.method === "GET" && path === "/api/pilot/session") return json({ authenticated: true, consent: tester.consent === 1, aiEnabled: aiEnabled(env), consentVersion: VERSION });
    csrf(request);
    if (request.method === "POST" && path === "/api/pilot/logout") { await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(tester.id).run(); return json({ authenticated: false }, 200, { "set-cookie": setCookie(COOKIE, "", 0) }); }
    if (request.method === "POST" && path === "/api/pilot/consent") { const input = await body(request); exact(input, ["consent", "version"]); if (input.consent !== true || input.version !== VERSION) deny(400, "Explicit current consent is required."); await env.DB.prepare("UPDATE participants SET consent=1,consent_version=?,consented_at=? WHERE id=?").bind(VERSION, Date.now(), tester.participant_id).run(); return json({ consent: true, version: VERSION }); }
    if (request.method === "DELETE" && path === "/api/pilot/data") { await env.DB.batch([env.DB.prepare("UPDATE participants SET consent=0,consent_version=NULL,consented_at=NULL WHERE id=?").bind(tester.participant_id), env.DB.prepare("DELETE FROM events WHERE participant_id=?").bind(tester.participant_id), env.DB.prepare("DELETE FROM feedback WHERE participant_id=?").bind(tester.participant_id)]); return json({ consent: false, deleted: true }); }
    if (request.method === "POST" && (path === "/api/pilot/events" || path === "/api/pilot/feedback")) {
      if (tester.consent !== 1) deny(403, "Opt-in consent is required for collection.");
      const input = await body(request, path.endsWith("feedback") ? 12000 : 4096); const kind = path.endsWith("events") ? "event" : "feedback";
      const details = kind === "event" ? validateEvent(input) : (validateFeedback(input), null);
      const claim = await admission(env, tester.participant_id, kind, kind === "event" ? 500 : 20, true);
      const insert = kind === "event" ? env.DB.prepare("INSERT INTO events(id,participant_id,name,session_id,details_json,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM admissions WHERE id=?) AND EXISTS(SELECT 1 FROM participants WHERE id=? AND consent=1)").bind(claim.id, tester.participant_id, input.event, input.sessionId, JSON.stringify(details), claim.now, claim.id, tester.participant_id) : env.DB.prepare("INSERT INTO feedback(id,participant_id,rating,accuracy,goal,outcome,comment,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM admissions WHERE id=?) AND EXISTS(SELECT 1 FROM participants WHERE id=? AND consent=1)").bind(claim.id, tester.participant_id, input.rating, input.accuracy, input.goal, input.outcome, input.comment, claim.now, claim.id, tester.participant_id);
      const result = await env.DB.batch([claim.statement, insert]);
      if (result[1].meta.changes !== 1) deny(429, "Daily collection allowance reached or consent withdrawn.");
      return json({ accepted: true }, 201);
    }
    deny(404, "Unknown pilot operation.");
  }
  return proxy(request, env, tester);
}
export default {
  async fetch(request, env) { try { return await handle(request, env); } catch (error) { return json({ error: error instanceof Denied ? error.message : "Pilot temporarily unavailable." }, error instanceof Denied ? error.status : 503); } },
  async scheduled(_event, env, ctx) { ctx.waitUntil(cleanup(env)); },
};
