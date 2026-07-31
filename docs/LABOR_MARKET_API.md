# Labor-market API boundary

These routes are a server-side data-access boundary for the browser workspace. They are not a general-purpose public proxy and must be covered by the deployment's public-route rate limiter.

## `POST /api/labor-market/onet`

Request (maximum 4 KiB, `application/json` only):

```json
{ "occupationCode": "15-1252.00" }
```

The server reads `ONET_API_KEY` and sends it only in the official O*NET v2 `X-API-Key` header; the key is neither accepted from nor returned to the client. It calls `https://api-v2.onetcenter.org/online/occupations/{code}/`. An unconfigured deployment returns 503 instead of synthetic data. Successful responses contain only the bounded occupation-overview fields actually fetched: code, title, description, reported titles, `updated.year/contents`, official O*NET URL, retrieval timestamp, and uncertainty statement. Skills/tasks/knowledge/technology arrays are omitted until their individual bounded subresource endpoints are implemented.

## `POST /api/labor-market/bls-series`

Request (maximum 4 KiB, `application/json` only):

```json
{
  "seriesIds": ["CES0000000001"],
  "startYear": 2025,
  "endYear": 2026
}
```

With `BLS_API_KEY`, one to 50 validated series IDs and a maximum 20-year range are accepted; without it, the official limits are 25 series and 10 years. `BLS_API_KEY` remains server-side. Provider messages, missing/extra/duplicate series, empty data, and invalid rows fail closed. Every result has `kind: "observational_series"`, keeps the exact requested BLS series ID, latest observed period, retrieval timestamp, source URL, geography warning, and uncertainty statement. It intentionally has no occupational-projection fields.

## Projection import

The current BLS Public Data API time-series adapter is not an Employment Projections adapter. The browser therefore accepts a separately sourced projection snapshot only through a strict schema and labels it `user_supplied_unverified`. It requires:

- occupation code and title;
- geography and current employment level;
- projected growth, annual openings, and replacement openings as distinct fields;
- median wage as a structured amount, ISO-style currency code, period, and unit when supplied;
- projection start and end years;
- official `bls.gov` source URL;
- source as-of date and retrieval timestamp; and
- a non-empty uncertainty statement.

Missing inputs, stale data (older than three years), future dates, non-BLS URLs, reversed projection periods, and a projection SOC code that does not match the O*NET occupation all fail closed. A failed import produces no trend label.

## Operational limits

- Provider responses are capped at 512 KiB after transfer decoding.
- Provider calls time out after 10 seconds.
- Missing or non-JSON provider responses fail closed.
- Responses use `Cache-Control: no-store`.
- No live provider call occurs in the automated suite; provider adapters are injected and mocked.
- O*NET contract compatibility still requires an authorized credential-backed staging check before public release.
- The application-wide public-route rate limiter must include both endpoints before internet exposure.
