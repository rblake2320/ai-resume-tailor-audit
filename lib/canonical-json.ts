/**
 * Deterministic JSON for signing and hashing.
 *
 * The submission receipt previously MAC'd `JSON.stringify(unsigned)`, which
 * preserves the *insertion* order of whatever object it was handed. That made
 * verification depend on JSON transport happening to round-trip key order, so
 * any client that reconstructed the receipt produced a verification failure
 * indistinguishable from tampering.
 *
 * Keys are ordered by UTF-16 code unit, not `localeCompare`, because
 * `localeCompare` is locale- and ICU-dependent and would make a signature
 * verify on one host and fail on another.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new Error("undefined cannot be canonicalised.");
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite numbers cannot be canonicalised.");
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry ?? null)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}
