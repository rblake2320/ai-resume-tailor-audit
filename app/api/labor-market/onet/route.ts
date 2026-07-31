import { configuredLaborMarketHandlers } from "@/lib/labor-market-api";
import { enforcePublicRateLimit } from "@/lib/durable-rate-limit";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const limited = enforcePublicRateLimit("labor-market-onet", { limit: 30, windowMs: 60_000 });
  return limited ?? configuredLaborMarketHandlers.onet(request);
}
