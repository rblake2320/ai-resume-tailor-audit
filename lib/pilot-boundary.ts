import { timingSafeEqual } from "node:crypto";

const publicPilotApis = new Set([
  "/api/fetch-job", "/api/parse-resume", "/api/jobs/import",
  "/api/labor-market/bls-series", "/api/labor-market/onet", "/api/tailor",
]);

/** Independent origin admission: a leaked tunnel URL cannot bypass the gateway. */
export function pilotBoundary(request: Request, environment: Record<string, string | undefined> = process.env): Response | null {
  if (environment.RESUME_FOUNDRY_PILOT_MODE !== "true") return null;
  const expected = environment.RESUME_FOUNDRY_PILOT_ORIGIN_SECRET ?? "";
  if (expected.length < 32) return Response.json({ error: "Tester gateway is not configured." }, { status: 503 });
  const actual = request.headers.get("x-resume-pilot-origin") ?? "";
  if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    return Response.json({ error: "Use your tester invitation link." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/") && !(
    request.method === "GET" && pathname === "/api/capabilities" ||
    request.method === "POST" && publicPilotApis.has(pathname)
  )) return Response.json({ error: "This operation is not available in the tester pilot." }, { status: 403 });
  if (pathname === "/api/tailor" && environment.RESUME_FOUNDRY_PILOT_AI_ENABLED !== "true") {
    return Response.json({ error: "Live AI is paused for this tester pilot while its credit budget is configured. You can test job imports, private storage, sample results and feedback." }, { status: 503 });
  }
  return null;
}
