// Native Node type stripping requires the explicit extension; the application
// compiler intentionally does not enable TypeScript-extension imports.
// @ts-expect-error -- executed directly by node --experimental-strip-types.
import { createDurableFixedWindowLimiter } from "../durable-rate-limit.ts";

const [directory, scope, limit, windowMs, timestamp] = process.argv.slice(2);
const limiter = createDurableFixedWindowLimiter({ directory, scope, limit: Number(limit), windowMs: Number(windowMs), now: () => Number(timestamp) });
process.stdout.write(limiter.take().allowed ? "WON" : "LOST");
