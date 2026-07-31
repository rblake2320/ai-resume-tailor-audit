import { afterEach, describe, expect, it } from "vitest";
import { POST as tailorPost, TAILOR_BODY_MAX_BYTES } from "../app/api/tailor/route";
import { POST as agentPost, AGENT_BODY_MAX_BYTES } from "../app/api/agent/[operation]/route";
import { POST as fetchJobPost } from "../app/api/fetch-job/route";
import { POST as disconnectPost } from "../app/api/connections/google/disconnect/route";

const originalApiKey = process.env.ANTHROPIC_API_KEY;
const originalAgentToken = process.env.RESUME_FOUNDRY_AGENT_API_TOKEN;
afterEach(() => {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalApiKey;
  if (originalAgentToken === undefined) delete process.env.RESUME_FOUNDRY_AGENT_API_TOKEN; else process.env.RESUME_FOUNDRY_AGENT_API_TOKEN = originalAgentToken;
});

describe("network route boundaries", () => {
  it("rejects an oversized tailor request before an Anthropic call", async () => {
    process.env.ANTHROPIC_API_KEY = "synthetic-never-used";
    const response = await tailorPost(new Request("https://app.test/api/tailor", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resume: "x".repeat(TAILOR_BODY_MAX_BYTES), jobDescription: "valid" }),
    }) as never);
    expect(response.status).toBe(413);
  });

  it("rejects an oversized agent request before store mutation", async () => {
    process.env.RESUME_FOUNDRY_AGENT_API_TOKEN = "test-token";
    const response = await agentPost(new Request("https://app.test/api/agent/jobs.search", {
      method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: JSON.stringify({ input: { query: "x".repeat(AGENT_BODY_MAX_BYTES) } }),
    }), { params: Promise.resolve({ operation: "jobs.search" }) });
    expect(response.status).toBe(413);
  });

  it("rejects LinkedIn and Indeed without making a network request", async () => {
    for (const url of ["https://www.linkedin.com/jobs/view/1", "https://jobs.indeed.com/viewjob?jk=1"]) {
      const response = await fetchJobPost(new Request("https://app.test/api/fetch-job", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
      }) as never);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/LinkedIn and Indeed/) });
    }
  });

  it("rejects cross-origin Google disconnect requests", async () => {
    const response = await disconnectPost(new Request("https://app.test/api/connections/google/disconnect", {
      method: "POST", headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
    }));
    expect(response.status).toBe(403);
  });
});
