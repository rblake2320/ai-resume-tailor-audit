/**
 * Child-process probe for the cross-process nonce test.
 *
 * Deliberately a separate OS process: the defect being guarded against was a
 * module-scoped promise queue that serialises only inside one Node process, so
 * a same-process test cannot detect it.
 *
 * Usage: node --experimental-strip-types consume-nonce-probe.ts <dir> <nonce>
 * Prints exactly "WON" or "LOST".
 */
import { createDurableNonceStore } from "../nonce-store.ts";

const [directory, nonce] = process.argv.slice(2);
const store = createDurableNonceStore({ directory });
process.stdout.write(store.consume(nonce) ? "WON" : "LOST");
