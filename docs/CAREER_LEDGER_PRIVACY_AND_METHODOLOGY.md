# Career Ledger privacy, durability, and labor-market methodology

## Ownership and youth privacy

The Career Ledger is private by default. It collects an age band—not a full birth date—only when the owner chooses. Minor mode forbids a public profile, keeps guardian assistance optional, preserves ownership with the young person, records no advertising consent, and schedules an age-of-majority control review. Private records are not sold or used for model training without separate explicit consent. Public launch still requires jurisdiction-specific youth privacy, safety, accessibility, and records review.

## Custody and recovery

The browser vault stores only an AES-256-GCM encrypted envelope derived with PBKDF2-SHA256 (310,000 iterations); plaintext ledger content is held only while unlocked. The same provider-independent JSON envelope is downloadable and restorable without Resume Foundry. Schema-v1 plaintext vaults migrate once into schema v2 and are immediately encrypted. Item erasure removes content, rebuilds the hash chain, and retains only a non-content deletion receipt; full account deletion removes the browser vault. Owners should keep offline backups and the passphrase separately. No service can recover a forgotten passphrase.

Succession/recovery is owner-directed: the owner may place an encrypted recovery bundle and its passphrase (stored separately) with a trusted person or estate process. Resume Foundry does not create a hidden recovery key, guardian override, or provider lock-in. A future optional sync provider must preserve bulk export, cryptographic erasure, and independent restore; it cannot become the sole copy.

## Trend classification

“Growing,” “stable,” “transforming,” and “declining” are Resume Foundry decision-support labels, not BLS labels or predictions about a person:

- growing: projected employment growth >= 5%
- declining: projected employment growth <= -2%
- transforming: growth between thresholds but replacement openings >= 5% of current employment
- stable: growth between thresholds without the transforming condition
- insufficient data: no growth value

Every saved result preserves employment level, growth rate, annual openings, replacement openings, geography, source URL, as-of date, projection years, retrieval time, and uncertainty statement. Missing required fields or a source date older than three years produces no trend classification. Decline never means “no jobs”; openings and replacement demand remain separate measures.

The BLS Public Data API time-series method and the BLS Employment Projections program are separate data products. Resume Foundry exposes queried time series only as `observational_series`; it never converts those values into occupational growth projections. Until a projections-specific connector with authoritative field mapping exists, a projection snapshot must be imported explicitly and must pass the strict provenance schema. The UI keeps this boundary visible.

O*NET lookup is performed server-side using deployment credentials (`ONET_USERNAME` and `ONET_PASSWORD`). Credentials are never accepted from or returned to the browser. Provider requests and responses are size-bounded, malformed or undated O*NET data fails closed, and tests inject provider adapters rather than making live calls.

Training recommendations appear only when a resource maps to an explicit evidence gap. Each keeps provider/source, price and currency, duration, prerequisites, accessibility, accreditation, evidence quality, and as-of date. Rankings are scenarios, not promises of employment, wages, admission, certification, or fit.

Saved path records are validated and stored browser-locally with a bounded history and malformed-state quarantine. They are removed by “Erase all my data.” Unlike the encrypted Career Ledger vault, this workspace record is not currently passphrase-encrypted; users handling sensitive evidence gaps should keep them in the encrypted ledger and avoid saving them here until those stores are unified.

Primary sources: BLS developer resources (https://www.bls.gov/audience/developers.htm), BLS projections methodology (https://www.bls.gov/emp/documentation/data-overview.htm), O*NET Web Services (https://services.onetcenter.org/), and U.S. DOL youth career preparation (https://www.dol.gov/agencies/odep/program-areas/individuals/youth/career-preparation).
