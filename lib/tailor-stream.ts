import { TailorResultSchema, type TailorResult } from "./schema";

// Bound both the whole response and a single unterminated event before parsing.
export const TAILOR_STREAM_MAX_BYTES = 2_000_000;
export const TAILOR_EVENT_MAX_CHARS = 1_000_000;

/** Validate the network boundary before rendering or persisting generated content. */
export async function readTailorStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (chars: number) => void,
): Promise<TailorResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  const parse = (line: string): TailorResult | undefined => {
    if (!line.trim()) return;
    if (line.length > TAILOR_EVENT_MAX_CHARS) throw new Error("The generation response exceeded the safe size limit.");
    let event: unknown;
    try { event = JSON.parse(line); }
    catch { throw new Error("The generation stream contained malformed data. Try again."); }
    if (!event || typeof event !== "object") throw new Error("Unexpected generation event.");
    const item = event as Record<string, unknown>;
    if (item.type === "progress" && Number.isSafeInteger(item.chars) && (item.chars as number) >= 0) {
      onProgress(item.chars as number);
    } else if (item.type === "result") {
      const parsed = TailorResultSchema.safeParse(item.data);
      if (!parsed.success) throw new Error("The generated documents were invalid and were withheld. Try again.");
      return parsed.data;
    } else if (item.type === "error" && typeof item.message === "string" && item.message.trim()) {
      throw new Error(item.message);
    } else {
      throw new Error("Unexpected generation event.");
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        bytes += value.byteLength;
        if (bytes > TAILOR_STREAM_MAX_BYTES) throw new Error("The generation response exceeded the safe size limit.");
        buffer += decoder.decode(value, { stream: true });
      }
      if (done) buffer += decoder.decode();
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        const result = parse(line);
        if (result) return result;
      }
      if (buffer.length > TAILOR_EVENT_MAX_CHARS) throw new Error("The generation response exceeded the safe size limit.");
      if (done) {
        const result = parse(buffer);
        if (result) return result;
        throw new Error("The stream ended unexpectedly. Try again.");
      }
    }
  } finally {
    // Terminate producer work after success, invalid data, or an interrupted read.
    try { await reader.cancel(); } catch { /* A failed transport is already closed. */ }
    reader.releaseLock();
  }
}
