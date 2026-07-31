import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchGreenhouse, fetchLever, fetchUsaJobs, parseForwardedJobAlert } from "@/lib/job-connectors";

export const runtime = "nodejs";
const RequestSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("greenhouse"), query: z.string().min(1).max(100) }),
  z.strictObject({ source: z.literal("lever"), query: z.string().min(1).max(100), maxPages: z.number().int().min(1).max(20).optional() }),
  z.strictObject({ source: z.literal("usajobs"), query: z.string().min(1).max(300), maxPages: z.number().int().min(1).max(20).optional() }),
  z.strictObject({ source: z.literal("email"), payload: z.string().min(100).max(1_000_000) }),
]);

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid connector request." }, { status: 400 });
  try {
    const value = parsed.data;
    const jobs = value.source === "greenhouse" ? await fetchGreenhouse(value.query)
      : value.source === "lever" ? await fetchLever(value.query, { maxPages: value.maxPages })
      : value.source === "usajobs" ? await fetchUsaJobs(value.query, { apiKey: process.env.USAJOBS_API_KEY ?? "", userAgent: process.env.USAJOBS_USER_AGENT ?? "" }, { maxPages: value.maxPages })
      : parseForwardedJobAlert(value.payload);
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connector failed.";
    return NextResponse.json({ error: message }, { status: message.includes("not configured") ? 503 : 502 });
  }
}
