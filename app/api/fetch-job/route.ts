import { NextRequest } from "next/server";
import { z } from "zod";
import { extractTitle, htmlToText } from "@/lib/html";
import { assertPublicUrl, safeFetch, SsrfError } from "@/lib/ssrf";

export const runtime = "nodejs";

const BodySchema = z.object({ url: z.url() });

export async function POST(req: NextRequest): Promise<Response> {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Send a valid job posting URL." }, { status: 400 });
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
    });

    if (!res.ok) {
      return Response.json(
        { error: `The site returned ${res.status}. It may require login — paste the posting text instead.` },
        { status: 422 },
      );
    }

    const html = await res.text();
    const text = htmlToText(html);
    if (text.length < 200) {
      return Response.json(
        { error: "Couldn't extract a job description from that page (it may be behind a login, like LinkedIn). Paste the posting text instead." },
        { status: 422 },
      );
    }

    return Response.json({ text: text.slice(0, 50_000), title: extractTitle(html) });
  } catch {
    return Response.json(
      { error: "Couldn't reach that URL. Check it, or paste the posting text instead." },
      { status: 422 },
    );
  }
}
