import { NextRequest } from "next/server";
import { extractText } from "unpdf";
import { HttpLimitError, readRequestBytes } from "@/lib/http-limits";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const PARSE_RESUME_BODY_MAX_BYTES = MAX_BYTES + 64 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
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

  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const { text } = await extractText(buffer, { mergePages: true });
      const cleaned = text.trim();
      if (!cleaned) {
        return Response.json(
          { error: "No selectable text found in this PDF — it may be a scanned image. Paste the text instead." },
          { status: 422 },
        );
      }
      return Response.json({ text: cleaned });
    }
    if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
      return Response.json({ text: (await file.text()).trim() });
    }
    return Response.json(
      { error: "Unsupported file type. Upload a PDF, .txt, or .md file — or paste the text." },
      { status: 415 },
    );
  } catch {
    return Response.json(
      { error: "Could not read that file. Paste the resume text instead." },
      { status: 422 },
    );
  }
}
