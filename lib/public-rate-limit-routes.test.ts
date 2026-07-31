import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as tailor } from "../app/api/tailor/route";
import { POST as fetchJob } from "../app/api/fetch-job/route";
import { POST as importJobs } from "../app/api/jobs/import/route";
import { POST as parseResume } from "../app/api/parse-resume/route";
import { POST as onet } from "../app/api/labor-market/onet/route";
import { POST as blsSeries } from "../app/api/labor-market/bls-series/route";

let directory = "";
const saved = new Map<string, string | undefined>();
const names = ["RESUME_FOUNDRY_RATE_LIMIT_DIR", "RESUME_FOUNDRY_TAILOR_LIMIT", "RESUME_FOUNDRY_FETCH_JOB_LIMIT", "RESUME_FOUNDRY_JOBS_IMPORT_LIMIT", "RESUME_FOUNDRY_PARSE_RESUME_LIMIT", "RESUME_FOUNDRY_LABOR_MARKET_ONET_LIMIT", "RESUME_FOUNDRY_LABOR_MARKET_BLS_SERIES_LIMIT"];

beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-31T12:00:30Z"));
  directory = await mkdtemp(path.join(tmpdir(), "rf-route-limit-"));
  for (const name of names) saved.set(name, process.env[name]);
  process.env.RESUME_FOUNDRY_RATE_LIMIT_DIR = directory;
  process.env.RESUME_FOUNDRY_TAILOR_LIMIT = "1";
  process.env.RESUME_FOUNDRY_FETCH_JOB_LIMIT = "1";
  process.env.RESUME_FOUNDRY_JOBS_IMPORT_LIMIT = "1";
  process.env.RESUME_FOUNDRY_PARSE_RESUME_LIMIT = "1";
  process.env.RESUME_FOUNDRY_LABOR_MARKET_ONET_LIMIT = "1";
  process.env.RESUME_FOUNDRY_LABOR_MARKET_BLS_SERIES_LIMIT = "1";
});

afterEach(async () => {
  vi.useRealTimers();
  for (const name of names) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  saved.clear();
  await rm(directory, { recursive: true, force: true });
});

describe("public route overload boundary", () => {
  const cases = [
    ["tailor", tailor, () => new NextRequest("http://test/api/tailor", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })],
    ["fetch-job", fetchJob, () => new NextRequest("http://test/api/fetch-job", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })],
    ["jobs-import", importJobs, () => new NextRequest("http://test/api/jobs/import", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })],
    ["parse-resume", parseResume, () => new NextRequest("http://test/api/parse-resume", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })],
    ["labor-market-onet", onet, () => new NextRequest("http://test/api/labor-market/onet", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })],
    ["labor-market-bls-series", blsSeries, () => new NextRequest("http://test/api/labor-market/bls-series", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })],
  ] as const;

  it.each(cases)("limits %s before doing a second unit of work", async (_scope, handler, request) => {
    expect((await handler(request() as never)).status).not.toBe(429);
    const response = await handler(request() as never);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/u);
    expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
  });
});
