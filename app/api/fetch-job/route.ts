import { NextRequest } from "next/server";
import { z } from "zod";
import { extractTitle, htmlToText } from "@/lib/html";
import { assertPublicUrl, safeFetch, SsrfError } from "@/lib/ssrf";
import { HttpLimitError, readJsonBody, readResponseText } from "@/lib/http-limits";

export const runtime = "nodejs";

const BodySchema = z.strictObject({ url: z.url().max(2_048) });
export const FETCH_JOB_BODY_MAX_BYTES = 4_096;
export const FETCH_JOB_RESPONSE_MAX_BYTES = 1_000_000;

const PROHIBITED_JOB_DOMAINS = ["linkedin.com", "linkedin.cn", "indeed.com", "indeed.co.uk"];
export function assertPermittedJobUrl(url: URL): void {
  const host = url.hostname.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  if (PROHIBITED_JOB_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new SsrfError("prohibited_job_host");
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req, FETCH_JOB_BODY_MAX_BYTES);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: error instanceof HttpLimitError ? error.status : 400 },
    );
  }
  const body = BodySchema.safeParse(rawBody);
  if (!body.success) {
    return Response.json({ error: "Send a valid job posting URL." }, { status: 400 });
  }
  try { assertPermittedJobUrl(new URL(body.data.url)); } catch (error) {
    if (!(error instanceof SsrfError) || error.reason !== "prohibited_job_host") throw error;
    return Response.json(
      { error: "Automated fetching from LinkedIn and Indeed is not supported. Paste the posting text instead." },
      { status: 400 },
    );
  }

  // Validate scheme + resolve DNS and reject loopback/private/link-local/
  // metadata/reserved addresses BEFORE any network call. Redirects are
  // re-validated per hop inside safeFetch, so a public page cannot bounce us
  // onto an internal address.
  try {
    await assertPublicUrl(body.data.url);
  } catch (e) {
    if (e instanceof SsrfError) {
      return Response.json(
        { error: "Only public http(s) job-posting URLs are supported (no local, private, or internal addresses)." },
        { status: 400 },
      );
    }
    throw e;
  }

  try {
    const res = await safeFetch(body.data.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    }, 5, assertPermittedJobUrl);

    if (!res.ok) {
      return Response.json(
        { error: `The site returned ${res.status}. It may require login — paste the posting text instead.` },
        { status: 422 },
      );
    }

    const contentType = res.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      await res.body?.cancel("unsupported content type").catch(() => undefined);
      return Response.json(
        { error: "That URL did not return an HTML job posting. Paste the posting text instead." },
        { status: 422 },
      );
    }

    const html = await readResponseText(res, FETCH_JOB_RESPONSE_MAX_BYTES);
    const text = htmlToText(html);
    if (text.length < 200) {
      return Response.json(
        { error: "Couldn't extract a job description from that page (it may be behind a login, like LinkedIn). Paste the posting text instead." },
        { status: 422 },
      );
    }

    return Response.json({ text: text.slice(0, 50_000), title: extractTitle(html) });
  } catch (error) {
    if (error instanceof HttpLimitError) {
      return Response.json({ error: "That page is too large to fetch safely. Paste the posting text instead." }, { status: 422 });
    }
    return Response.json(
      { error: "Couldn't reach that URL. Check it, or paste the posting text instead." },
      { status: 422 },
    );
  }
}
