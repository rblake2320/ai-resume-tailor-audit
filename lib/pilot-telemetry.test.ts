import { afterEach, describe, expect, it, vi } from "vitest";
import { setPilotTelemetryConsent, trackPilotEvent } from "./pilot-telemetry";

describe("content-free tester telemetry", () => {
  afterEach(() => { setPilotTelemetryConsent(false); vi.unstubAllGlobals(); });
  it("sends nothing without consent or after withdrawal", () => {
    const fetcher = vi.fn().mockResolvedValue(new Response()); vi.stubGlobal("fetch", fetcher);
    trackPilotEvent("generation_started"); expect(fetcher).not.toHaveBeenCalled();
    setPilotTelemetryConsent(true); trackPilotEvent("generation_started"); expect(fetcher).toHaveBeenCalledOnce();
    setPilotTelemetryConsent(false); trackPilotEvent("generation_started"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("whitelists runtime extras and caps numeric metadata instead of reading content", () => {
    const fetcher = vi.fn().mockResolvedValue(new Response()); vi.stubGlobal("fetch", fetcher);
    setPilotTelemetryConsent(true);
    trackPilotEvent("generation_completed", { durationMs: 500_000, score: 50, resume: "Private résumé text", email: "private@example.test" } as never);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toEqual({ event: "generation_completed", sessionId: expect.any(String), details: { durationMs: 300000, score: 50 } });
    expect(fetcher.mock.calls[0][1].body).not.toMatch(/Private|private@example|email|resume/);
  });
  it("contains network failures so telemetry cannot prevent product use", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    setPilotTelemetryConsent(true); expect(() => trackPilotEvent("session_started")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
