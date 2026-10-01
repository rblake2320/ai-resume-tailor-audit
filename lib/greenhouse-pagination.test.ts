import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { fetchGreenhousePage } from "./job-connectors";

describe("bounded Greenhouse page receiving", () => {
  it("uses compact metadata and bounded concurrent detail reads for large boards", async () => {
    let active = 0, peak = 0; const calls: string[] = [];
    const server = createServer(async (request, response) => {
      calls.push(request.url ?? ""); response.setHeader("content-type", "application/json");
      if (request.url?.includes("?content=false")) { response.end(JSON.stringify({ jobs: Array.from({ length: 1000 }, (_, id) => ({ id, title: `Job ${id}` })) })); return; }
      active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10));
      const id = Number(request.url?.split("/").at(-1)); response.end(JSON.stringify({ id, title: `Job ${id}`, content: `<p>${"Detailed engineering responsibilities. ".repeat(20)}</p>`, absolute_url: `https://example.test/jobs/${id}` })); active -= 1;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture address.");
    const fetcher: typeof fetch = (input, init) => { const url = new URL(String(input)); return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
    try {
      const first = await fetchGreenhousePage("fixture", { pageSize: 5, fetcher });
      const second = await fetchGreenhousePage("fixture", { offset: first.nextOffset!, pageSize: 5, fetcher });
      expect(first).toMatchObject({ total: 1000, nextOffset: 5 }); expect(second.nextOffset).toBe(10);
      expect(first.jobs.map((job) => job.sourceId)).toEqual(["0", "1", "2", "3", "4"]);
      expect(second.jobs.map((job) => job.sourceId)).toEqual(["5", "6", "7", "8", "9"]);
      expect(calls).toHaveLength(12); expect(peak).toBeLessThanOrEqual(4); expect(calls.every((url) => !url.includes("content=true"))).toBe(true);
      expect(first.jobs[0].description.length).toBeGreaterThan(100);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("refuses malformed metadata and mismatched detail identities", async () => {
    await expect(fetchGreenhousePage("fixture", { fetcher: async () => Response.json({}) })).rejects.toThrow();
    const fetcher: typeof fetch = async (input) => String(input).includes("content=false") ? Response.json({ jobs: [{ id: 1 }] }) : Response.json({ id: 2, content: "Other job" });
    await expect(fetchGreenhousePage("fixture", { fetcher })).rejects.toThrow(/different/);
    await expect(fetchGreenhousePage("fixture", { offset: -1, fetcher })).rejects.toThrow();
  });
});
