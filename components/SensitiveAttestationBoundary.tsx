export function SensitiveAttestationBoundary() {
  return <section className="rounded-xl border border-amber-500/40 bg-amber-950/10 p-4" aria-labelledby="attestation-boundary-heading">
    <h2 id="attestation-boundary-heading" className="font-display text-xl font-semibold text-paper">Sensitive-work employer attestations</h2>
    <p className="mt-2 text-sm font-semibold text-amber-300">Cryptographically verified employer attestation — not a security clearance or government endorsement.</p>
    <p className="mt-2 text-xs text-ink-300">A future authorized issuer may confirm a narrowly approved, unclassified predicate without disclosing a program, customer, contract, duties, technology, location, facility, clearance level, or classified content. Current clearance and access verification remains with the applicable government and employing organization process.</p>
    <p className="mt-2 text-[10px] text-ink-500">Synthetic profile only. No real clearance data, DISS integration, or public pilot is enabled.</p>
  </section>;
}
