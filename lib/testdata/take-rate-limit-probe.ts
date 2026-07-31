// Native Node type stripping requires the explicit extension. The compiler
// permits it because this probe and the MCP entrypoint run without a bundler.
import { createDurableFixedWindowLimiter } from "../durable-rate-limit.ts";

const [directory, scope, limit, windowMs, timestamp] = process.argv.slice(2);
const limiter = createDurableFixedWindowLimiter({ directory, scope, limit: Number(limit), windowMs: Number(windowMs), now: () => Number(timestamp) });
process.stdout.write(limiter.take().allowed ? "WON" : "LOST");
