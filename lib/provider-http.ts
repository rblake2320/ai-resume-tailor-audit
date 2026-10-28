import { readResponseText } from "./http-limits.ts";

/** Fixed provider destinations still need deadlines, response budgets and no redirects. */
export function providerFetch(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
  const deadline = AbortSignal.timeout(15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  return fetcher(url, { ...init, signal, redirect: "error" });
}

export async function providerJson(response: Response, maxBytes = 8 * 1024 * 1024): Promise<unknown> {
  if (response.redirected) {
    await response.body?.cancel("unexpected provider redirect").catch(() => undefined);
    throw new Error("Provider response unexpectedly followed a redirect.");
  }
  return JSON.parse(await readResponseText(response, maxBytes));
}
