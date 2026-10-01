import { z } from "zod";
import { readResponseText } from "./http-limits.ts";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.ts";
import { TailorResultSchema, assertTailorResultEvidence, reconcileTailorResultOutputReferences, tailorResultJsonSchema, type TailorRequest } from "./schema.ts";

const MODEL = "qwen3-vl:8b-instruct";
const ENDPOINT = "http://127.0.0.1:11434/api/chat";
let busy = false;
export class LocalTailorError extends Error {}

export function localResultJsonSchema(): Record<string, unknown> {
  const schema = tailorResultJsonSchema();
  const strip = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    // Ollama's grammar cannot expand the provider's 100,000-character limits.
    // Runtime Zod and the bounded response transport still enforce these limits.
    delete record.minLength; delete record.maxLength; delete record.$schema;
    for (const child of Object.values(record)) strip(child);
  };
  strip(schema);
  return schema;
}

/** Free pilot provider: fixed existing loopback service, no downloads or paid fallback. */
export async function generateLocalTailor(input: TailorRequest, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (input.resume.length + input.jobDescription.length > 12_000) throw new LocalTailorError("The free pilot accepts up to 12,000 combined résumé and job characters. Shorten the inputs and retry.");
  if (busy) throw new LocalTailorError("The free pilot model is handling another request. Your inputs are safe; try again shortly.");
  busy = true;
  try {
    const response = await fetcher(ENDPOINT, {
      method: "POST", headers: { "content-type": "application/json" }, redirect: "error", signal,
      body: JSON.stringify({ model: MODEL, stream: false,
        // Reuse the resident model/context. Do not change server configuration or pull weights.
        options: { num_ctx: 8192, num_predict: 3072, temperature: 0.1 },
        format: localResultJsonSchema(),
        messages: [{ role: "system", content: `${SYSTEM_PROMPT}\nBe concise. Use exact source substrings for every evidence citation. Do not cite your rewritten summaries as source evidence. Return the requested JSON only.` }, { role: "user", content: buildUserPrompt(input) }],
      }),
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
      await response.body?.cancel().catch(() => undefined);
      throw new LocalTailorError("The free local model is temporarily unavailable. No paid provider was called.");
    }
    const payload = z.object({ model: z.literal(MODEL), done: z.literal(true), done_reason: z.literal("stop"),
      message: z.object({ role: z.literal("assistant"), content: z.string().min(1).max(512_000) }),
    }).parse(JSON.parse(await readResponseText(response, 512_000)));
    const result = reconcileTailorResultOutputReferences(TailorResultSchema.parse(JSON.parse(payload.message.content)));
    assertTailorResultEvidence(result, input.resume);
    return result;
  } finally { busy = false; }
}
