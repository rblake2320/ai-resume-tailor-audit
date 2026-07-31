import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as tailorPost, TAILOR_BODY_MAX_BYTES } from "../app/api/tailor/route";
import { POST as agentPost, AGENT_BODY_MAX_BYTES } from "../app/api/agent/[operation]/route";
import { assertPermittedJobUrl, POST as fetchJobPost } from "../app/api/fetch-job/route";
import { isSameOriginMutation, POST as disconnectPost } from "../app/api/connections/google/disconnect/route";
import { JOB_IMPORT_BODY_MAX_BYTES, POST as importJobsPost } from "../app/api/jobs/import/route";
import { PARSE_RESUME_BODY_MAX_BYTES, POST as parseResumePost } from "../app/api/parse-resume/route";
import { safeFetch, SsrfError } from "./ssrf";
import { POST as approveSubmission, SUBMISSION_APPROVAL_BODY_MAX_BYTES } from "../app/api/submissions/approve/route";
import { POST as executeSubmission, SUBMISSION_EXECUTE_BODY_MAX_BYTES } from "../app/api/submissions/execute/route";

const originalApiKey = process.env.ANTHROPIC_API_KEY;
const originalAgentToken = process.env.RESUME_FOUNDRY_AGENT_API_TOKEN;
const originalApprovalSecret = process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET;
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalApiKey;
  if (originalAgentToken === undefined) delete process.env.RESUME_FOUNDRY_AGENT_API_TOKEN; else process.env.RESUME_FOUNDRY_AGENT_API_TOKEN = originalAgentToken;
  if (originalApprovalSecret === undefined) delete process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET; else process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = originalApprovalSecret;
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

  it("rejects oversized connector and multipart bodies before parsing", async () => {
    const jobs = await importJobsPost(new Request("https://app.test/api/jobs/import", {
      method: "POST", headers: { "content-type": "application/json", "content-length": String(JOB_IMPORT_BODY_MAX_BYTES + 1) }, body: "{}",
    }) as never);
    expect(jobs.status).toBe(413);
    const resume = await parseResumePost(new Request("https://app.test/api/parse-resume", {
      method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(PARSE_RESUME_BODY_MAX_BYTES + 1) }, body: "--x--",
    }) as never);
    expect(resume.status).toBe(413);
  });

  it("bounds both submission routes before approval, nonce consumption, or provider work", async () => {
    process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = "human-approval-secret-for-tests";
    const approval = await approveSubmission(new Request("https://app.test/api/submissions/approve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(SUBMISSION_APPROVAL_BODY_MAX_BYTES + 1),
        "x-resume-foundry-human-approval": "human-approval-secret-for-tests",
      },
      body: "{}",
    }));
    expect(approval.status).toBe(413);

    const execute = await executeSubmission(new Request("https://app.test/api/submissions/execute", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(SUBMISSION_EXECUTE_BODY_MAX_BYTES + 1) },
      body: "{}",
    }));
    expect(execute.status).toBe(413);
  });

  it("rejects unsupported submission media types and malformed declared lengths", async () => {
    process.env.RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET = "human-approval-secret-for-tests";
    const cases = [
      [approveSubmission, "https://app.test/api/submissions/approve", { "x-resume-foundry-human-approval": "human-approval-secret-for-tests" }],
      [executeSubmission, "https://app.test/api/submissions/execute", {}],
    ] as const;
    for (const [handler, url, authorization] of cases) {
      const media = await handler(new Request(url, { method: "POST", headers: { ...authorization, "content-type": "text/plain" }, body: "{}" }));
      expect(media.status).toBe(415);
      const length = await handler(new Request(url, { method: "POST", headers: { ...authorization, "content-type": "application/json", "content-length": "-1" }, body: "{}" }));
      expect(length.status).toBe(400);
    }
  });

  it("rejects LinkedIn and Indeed without making a network request", async () => {
    for (const url of [
      "https://www.linkedin.com/jobs/view/1", "https://jobs.indeed.com/viewjob?jk=1",
      "https://linkedin.com./jobs/view/1", "https://linkedin.cn/jobs/view/1", "https://indeed.co.uk/viewjob?jk=1",
    ]) {
      const response = await fetchJobPost(new Request("https://app.test/api/fetch-job", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
      }) as never);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/LinkedIn and Indeed/) });
    }
  });

  it("reapplies prohibited-host policy to every redirect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302, headers: { location: "https://www.linkedin.com/jobs/view/1" },
    })));
    await expect(safeFetch("https://8.8.8.8/jobs", {}, 5, assertPermittedJobUrl))
      .rejects.toMatchObject({ reason: "prohibited_job_host" } satisfies Partial<SsrfError>);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin Google disconnect requests", async () => {
    const response = await disconnectPost(new Request("https://app.test/api/connections/google/disconnect", {
      method: "POST", headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
    }));
    expect(response.status).toBe(403);
  });

  it("accepts only explicit same-origin disconnects, including configured TLS proxy origin", () => {
    expect(isSameOriginMutation(new Request("https://app.test/api/x", { method: "POST" }), {})).toBe(false);
    expect(isSameOriginMutation(new Request("https://app.test/api/x", { method: "POST", headers: { origin: "https://app.test", "sec-fetch-site": "same-origin" } }), {})).toBe(true);
    const proxied = new Request("http://internal:3000/api/x", { method: "POST", headers: { origin: "https://resume.example", "sec-fetch-site": "same-origin" } });
    expect(isSameOriginMutation(proxied, { RESUME_FOUNDRY_PUBLIC_ORIGIN: "https://resume.example" })).toBe(true);
    expect(isSameOriginMutation(proxied, { RESUME_FOUNDRY_PUBLIC_ORIGIN: "not a URL" })).toBe(false);
  });
});
