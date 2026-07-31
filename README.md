# Resume Foundry

**Evidence-linked AI résumé tailoring. One profile, any job, with unsupported claims surfaced for human review.**

Save your career history once, point it at any job posting (paste the text or just the URL), and get an honestly tailored, ATS-safe resume and cover letter — with a calibrated match score, a full diff of every change, a keyword gap analysis, and exports in DOCX, Markdown, plain text, and print/PDF.

Uses a deployment-configured Anthropic API model with structured outputs and adaptive thinking. Built with Next.js 16, React 19, TypeScript, and Tailwind CSS 4.

## Why this beats the usual tools

The 2026 market splits into distrusted black-box scorers, keyword-overlap trackers, template builders whose designs break real ATS parsing, and AI tools that quietly invent skills. Resume Foundry is built around the five things none of them combine:

| Principle | What it means here |
|---|---|
| **Evidence discipline** | The model is instructed to cite résumé evidence and list unsupported keywords under "Not added — no evidence." Deterministic validation is being expanded; generated content still requires human review. |
| **Transparent diff** | Every change is logged and classified: reworded, reordered, removed, or emphasized. You stay accountable for your own resume. |
| **Real parse view** | A "What the ATS sees" tab shows the exact plain text a parser extracts — if it reads cleanly there, it reads cleanly in Workday, Greenhouse, Lever, and iCIMS. |
| **2026-aware scoring** | Semantic matching, no keyword stuffing (modern ATS penalize it), calibrated scores with the arithmetic explained — plus an instant, deterministic keyword scan that runs in your browser before any AI. |
| **Local-first privacy** | Your working profile and run history stay browser-local. Long-lived career evidence uses an encrypted IndexedDB vault with portable encrypted backup, recovery drills, selective disclosure, and deletion controls. The app does not create a cloud profile. |
| **Job Inbox** | Save immutable, SHA-256-addressed posting snapshots; import CSV/JSON in bulk; skip duplicates by source ID, canonical URL, company/title/location, or description hash. |
| **Legitimate source connectors** | Import official Greenhouse and Lever public boards, USAJOBS searches, forwarded alerts, CSV/JSON, URLs, or manual text. LinkedIn/Indeed scraping and automated apply remain prohibited. |

## Features

- **Master profile** — paste or upload (PDF / .txt / .md) your resume once, plus an "everything else" field for projects, wins, and metrics that never fit on one page. Auto-saved locally.
- **Job by URL** — paste a public careers-page link and a bounded HTML response is fetched and extracted server-side. LinkedIn and Indeed automation is rejected; paste those postings manually.
- **Instant keyword scan** — deterministic, client-side coverage check the moment both fields are filled. Transparent baseline before the AI pass.
- **AI tailoring** — streaming analysis you can watch live, then: before/after match scores with rationale, classified change log, matched / honestly-added / not-added keywords, gap analysis with concrete advice, and ATS formatting checks.
- **Cover letter** — specific to your evidence and the posting, never generic filler.
- **Exports** — DOCX (ATS-safe single column), Markdown, plain text, print/PDF, one-click copy.
- **History** — past runs stored locally, reloadable, deletable.
- **Career Ledger** — append-only, correction-aware evidence captured across school, work, projects, volunteering, and life transitions; encrypted at rest with portable backup and age-aware privacy controls.
- **Career-path evidence workspace** — server-side O*NET lookup, explicitly labeled BLS observational-series lookup, current occupational-projection snapshot import, provenance-preserving trend classification, and training suggestions limited to explicit evidence gaps. O*NET requires deployment credentials; projection imports remain user/operator supplied until an authoritative projections connector is added.
- **Application operating system** — job inbox, immutable application packets, pipeline tracking, reminders, interview preparation, approved handoffs, official ATS connectors, and Gmail draft creation.
- **Agent interfaces** — bearer-authenticated HTTP/OpenAPI operations and a stdio MCP server share one permission, approval, rate-limit, persistence, and audit boundary.

## Quick start

```bash
git clone https://github.com/rblake2320/ai-resume-tailor-audit.git
cd ai-resume-tailor-audit
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Get an API key at [platform.claude.com](https://platform.claude.com/). The only required variable is `ANTHROPIC_API_KEY`; `RESUME_FOUNDRY_ANTHROPIC_MODEL` optionally overrides the default `claude-opus-5` without inheriting unrelated Claude CLI model aliases. `ANTHROPIC_MODEL` remains a lower-priority compatibility fallback.

The USAJOBS connector additionally reads `USAJOBS_API_KEY` and `USAJOBS_USER_AGENT`; Greenhouse and Lever public-board imports require no stored credentials. Career-path O*NET lookup reads server-only `ONET_USERNAME` and `ONET_PASSWORD`; optional `BLS_API_KEY` increases the public BLS API quota. The BLS time-series endpoint is not treated as an occupational-projections feed.

> The tailor endpoint enables Anthropic's server-side refusal fallback (`fallbacks: "default"`) so a rare safety-classifier decline re-routes automatically instead of failing the request.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Vitest unit tests (deterministic libs) |
| `npm run lint` | ESLint (flat config: typescript-eslint + Next + react-hooks) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run mcp` | Launch the stdio MCP tool server |

CI runs lint, typecheck, tests, build, and a high-severity dependency audit on every push and PR.

The labor-market route contracts and deployment boundaries are documented in [`docs/LABOR_MARKET_API.md`](docs/LABOR_MARKET_API.md).

## Architecture

```
app/
  page.tsx                 # the whole workshop UI (client)
  layout.tsx, globals.css  # fonts, theme, print styles
  api/tailor/route.ts      # Claude Opus 5: streaming + structured output + refusal fallback
  api/parse-resume/route.ts# PDF/.txt/.md → text (unpdf)
  api/fetch-job/route.ts   # job-posting URL → text (SSRF-guarded, dependency-free extraction)
components/
  ResultView.tsx           # scores, diff, keywords, gaps, ATS checks, document tabs
  ui.tsx                   # Section, ScoreDial, Chip, buttons
lib/
  schema.ts                # Zod schemas → JSON schema for structured output (tested)
  prompts.ts               # system + user prompts (honesty rules, 2026 ATS reality)
  ats.ts                   # deterministic keyword extraction + coverage scan (tested)
  html.ts                  # HTML → text for job fetch (tested)
  markdown.ts              # md → HTML render + md → ATS plain text (tested)
  docx-export.ts           # md → ATS-safe DOCX (docx package)
  storage.ts               # browser-local working profile + run history
  career-ledger.ts         # encrypted lifelong evidence ledger + portable recovery
  labor-market.ts          # O*NET/BLS adapters, projection provenance + path logic
  labor-market-api.ts      # bounded server-only provider boundary
  agent-service.ts         # shared HTTP/MCP policy, approval, persistence, and audit boundary
```

Design decisions worth knowing:

- **No cloud profile by default.** Working profile/history remain client-side and the career ledger is encrypted in IndexedDB. Agent automation has a separate durable server-side store and bearer-token boundary; it is not an internet-ready multi-tenant identity system.
- **Bounded ingress and fetching.** Tailoring, agent, connector, and résumé-upload bodies have pre-buffer byte limits and field/file maxima. Job-page reads enforce a timeout, redirect cap, standard web ports, HTML content type, prohibited-host policy on every redirect, and a 1 MB streaming limit before extraction.
- **Fail-closed single-host overload control.** Browser-facing AI, fetch, import, and parsing routes use cross-process atomic fixed-window limits from a deployment-configured private directory. This bounds local spend/work; it is not a substitute for tenant authentication or a distributed gateway limiter.
- **Structured outputs** (`output_config.format` with a strict JSON schema derived from Zod) request a parseable result; the same Zod schema re-validates server-side.
- **Streaming NDJSON** from the tailor route: live thinking summaries (`thinking: adaptive, display: summarized`), progress ticks, then the final validated result.
- **Fonts are npm-installed** (Fraunces, Instrument Sans, JetBrains Mono via Fontsource) — builds are hermetic, no network font fetch.

## Remaining production boundaries

- External interoperability and authorized legal/security review for sensitive-work attestations
- Independent youth-privacy, accessibility, labor-methodology, and security review of the lifelong ledger
- Public multi-user identity/tenant isolation, distributed/multi-host rate limiting, monitoring, retention policy, and disaster recovery
- LinkedIn/Indeed automation remains prohibited without an official approved mechanism

## License

[MIT](LICENSE)
