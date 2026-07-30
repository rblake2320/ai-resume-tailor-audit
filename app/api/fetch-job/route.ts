import { NextRequest } from "next/server";
import { z } from "zod";
import { extractTitle, htmlToText } from "@/lib/html";

export const runtime = "nodejs";

const BodySchema = z.object({ url: z.url() });

const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|.*\.local)$/i;

export async function POST(req: NextRequest): Promise<Response> {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Send a valid job posting URL." }, { status: 400 });
  }

  const url = new URL(body.data.url);
  if (!/^https?:$/.test(url.protocol) || PRIVATE_HOST.test(url.hostname)) {
    return Response.json({ error: "Only public http(s) URLs are supported." }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
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
