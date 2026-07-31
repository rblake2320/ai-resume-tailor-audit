import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompts";
import { assertTailorResultEvidence, HonestyValidationError, TailorRequestSchema, TailorResultSchema, tailorResultJsonSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

// Use an app-specific override first so unrelated shell/CLI aliases such as
// ANTHROPIC_MODEL=opusplan cannot silently break this production route.
const MODEL =
  process.env.RESUME_FOUNDRY_ANTHROPIC_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-opus-5";

type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "progress"; chars: number }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string };

export async function POST(req: NextRequest): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key." },
      { status: 500 },
    );
  }

  let parsed;
  try {
    parsed = TailorRequestSchema.parse(await req.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join(" ")
        : "Invalid request body.";
    return Response.json({ error: message }, { status: 400 });
  }

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        const msgStream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive", display: "summarized" },
          output_config: {
            format: { type: "json_schema", schema: tailorResultJsonSchema() },
          },
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserPrompt(parsed) }],
        }, { signal: req.signal });

        let chars = 0;
        let lastProgress = 0;
        let signalledThinking = false;
        for await (const event of msgStream) {
          if (event.type !== "content_block_delta") continue;
          if (event.delta.type === "thinking_delta") {
            // The model's internal reasoning is NOT forwarded to the client:
            // it can contain scoring deliberation, sanitization/injection-
            // handling narration, and drafting strategy. Emit a single neutral
            // progress ping so the UI shows liveness during the analysis phase.
            if (!signalledThinking) {
              signalledThinking = true;
              send({ type: "progress", chars: 0 });
            }
          } else if (event.delta.type === "text_delta") {
            chars += event.delta.text.length;
            if (chars - lastProgress > 400) {
              lastProgress = chars;
              send({ type: "progress", chars });
            }
          }
        }

        const final = await msgStream.finalMessage();
        if (final.stop_reason === "refusal") {
          send({
            type: "error",
            message:
              "The model declined this request. Remove any sensitive content from the inputs and try again.",
          });
        } else {
          const text = final.content
            .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
            .map((b) => b.text)
            .join("");
          const result = TailorResultSchema.parse(JSON.parse(text));
          assertTailorResultEvidence(result, parsed.resume);
          send({ type: "result", data: result });
        }
      } catch (err) {
        send({ type: "error", message: describeError(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function describeError(err: unknown): string {
  if (err instanceof HonestyValidationError) {
    return "The generated draft failed evidence validation and was withheld. No unverified draft was returned; review the source résumé and try again.";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "Invalid ANTHROPIC_API_KEY. Check .env.local.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Claude API. Wait a minute and try again.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Claude API. Check your network connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude API error (${err.status ?? "unknown"}): ${err.message}`;
  }
  if (err instanceof z.ZodError || err instanceof SyntaxError) {
    return "The model returned an unexpected response shape. Try again.";
  }
  return "Unexpected server error. Try again.";
}
