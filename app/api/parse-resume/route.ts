import { NextRequest } from "next/server";
import { extractText } from "unpdf";
import { HttpLimitError, readRequestBytes } from "@/lib/http-limits";
import { enforcePublicRateLimit } from "@/lib/durable-rate-limit";
import { extractWithTika, DocumentExtractionError, DOCUMENT_TEXT_MAX_CHARS } from "@/lib/tika";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const PARSE_RESUME_BODY_MAX_BYTES = MAX_BYTES + 64 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const limited = enforcePublicRateLimit("parse-resume", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  let form: FormData | null = null;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
      return Response.json({ error: "Content-Type must be multipart/form-data." }, { status: 415 });
    }
    const bytes = await readRequestBytes(req, PARSE_RESUME_BODY_MAX_BYTES);
    form = await new Request(req.url, { method: "POST", headers: { "content-type": contentType }, body: Uint8Array.from(bytes).buffer }).formData();
  } catch (error) {
    return Response.json(
      { error: error instanceof HttpLimitError ? error.message : "Invalid multipart form body." },
      { status: error instanceof HttpLimitError ? error.status : 400 },
    );
  }
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Upload a file in the 'file' field." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File too large (max 10 MB)." }, { status: 413 });
  }
  if (file.size === 0) return Response.json({ error: "The résumé file is empty." }, { status: 422 });

  const name = file.name.toLowerCase();
  const extension = name.split(".").at(-1) ?? "";
  try {
    if (["pdf", "doc", "docx", "rtf", "odt"].includes(extension) && (extension !== "pdf" || process.env.RESUME_FOUNDRY_DOCUMENT_PARSER !== "unpdf")) {
      const text = await extractWithTika(new Uint8Array(await file.arrayBuffer()), extension, req.signal);
      return Response.json({ text, parser: "apache-tika", parserVersion: "4.1.0" });
    }
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const { text } = await extractText(buffer, { mergePages: true });
      const cleaned = text.trim();
      if (cleaned.length > DOCUMENT_TEXT_MAX_CHARS) return Response.json({ error: "Résumé text exceeds 100,000 characters." }, { status: 413 });
      if (!cleaned) {
        return Response.json(
          { error: "No selectable text found in this PDF — it may be a scanned image. Paste the text instead." },
          { status: 422 },
        );
      }
      return Response.json({ text: cleaned });
    }
    if (name.endsWith(".txt") || name.endsWith(".md")) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()).trim();
      if (!text) return Response.json({ error: "The résumé file is empty. Upload readable text or paste it." }, { status: 422 });
      if (text.length > DOCUMENT_TEXT_MAX_CHARS) return Response.json({ error: "Résumé text exceeds 100,000 characters." }, { status: 413 });
      return Response.json({ text });
    }
    return Response.json(
      { error: "Unsupported file type. Upload PDF, DOCX, DOC, RTF, ODT, TXT or Markdown — or paste the text." },
      { status: 415 },
    );
  } catch (error) {
    if (error instanceof DocumentExtractionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json(
      { error: "Could not read that file. Paste the resume text instead." },
      { status: 422 },
    );
  }
}
