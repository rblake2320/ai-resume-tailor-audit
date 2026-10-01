import { z } from "zod";
import { readResponseText } from "./http-limits.ts";

export const TIKA_ENDPOINT = "http://127.0.0.1:9998/tika/json/text";
export const DOCUMENT_TEXT_MAX_CHARS = 100_000;
export class DocumentExtractionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const mediaTypes: Record<string, string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  odt: ["application/vnd.oasis.opendocument.text"],
  rtf: ["application/rtf", "text/rtf"],
};
let busy = false;

/** Upload bytes only; no caller URLs, filename hints, parser config or metadata disclosure. */
export async function extractWithTika(bytes: Uint8Array, extension: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  if (!mediaTypes[extension]) throw new DocumentExtractionError(415, "Unsupported résumé document format.");
  if (busy) throw new DocumentExtractionError(429, "The document parser is busy. Try again shortly.");
  busy = true;
  try {
    const response = await fetcher(TIKA_ENDPOINT, {
      method: "PUT", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
      headers: { "content-type": "application/octet-stream", accept: "application/json" },
      body: Uint8Array.from(bytes).buffer,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new DocumentExtractionError(response.status === 429 ? 429 : 422, "The document could not be fully extracted. Try a readable file or paste the text.");
    }
    if (!response.headers.get("content-type")?.startsWith("application/json")) throw new Error("Invalid parser response.");
    const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(await readResponseText(response, 512_000)));
    if (Object.entries(metadata).some(([key, value]) => /exception|deadline|write.?limit.?reached|truncat/i.test(key) && value !== false && value !== "false" && value !== null)) {
      throw new DocumentExtractionError(422, "Document extraction was incomplete. Paste the text or upload a smaller, readable document.");
    }
    if (!mediaTypes[extension].includes(String(metadata["Content-Type"]))) throw new DocumentExtractionError(415, "The file contents do not match the selected résumé document format.");
    const text = z.string().parse(metadata["tk:content"] ?? "").trim();
    if (!text) throw new DocumentExtractionError(422, "No readable text found. Scanned or encrypted documents require a text copy; paste the résumé instead.");
    if (text.length > DOCUMENT_TEXT_MAX_CHARS) throw new DocumentExtractionError(413, "Extracted résumé text exceeds 100,000 characters. Upload a shorter document.");
    return text;
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    if (signal.aborted) throw new DocumentExtractionError(408, "Document extraction was cancelled.");
    throw new DocumentExtractionError(503, "The private document parser is unavailable or timed out. Paste the résumé text instead.");
  } finally { busy = false; }
}
