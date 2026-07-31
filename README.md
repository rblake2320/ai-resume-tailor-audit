# Resume Foundry

**Honest AI resume tailoring. One profile, any job. Nothing fabricated, ever.**

Save your career history once, point it at any job posting (paste the text or just the URL), and get an honestly tailored, ATS-safe resume and cover letter — with a calibrated match score, a full diff of every change, a keyword gap analysis, and exports in DOCX, Markdown, plain text, and print/PDF.

Powered by **Claude Opus 5** with structured outputs and adaptive thinking. Built with Next.js 16, React 19, TypeScript, and Tailwind CSS 4.

## Why this beats the usual tools

The 2026 market splits into distrusted black-box scorers, keyword-overlap trackers, template builders whose designs break real ATS parsing, and AI tools that quietly invent skills. Resume Foundry is built around the five things none of them combine:

| Principle | What it means here |
|---|---|
| **Honesty guarantee** | The model never adds a skill, title, date, or metric without evidence in your history. Keywords it *can't* honestly add are listed under "Not added — no evidence", with reasons. |
| **Transparent diff** | Every change is logged and classified: reworded, reordered, removed, or emphasized. You stay accountable for your own resume. |
| **Real parse view** | A "What the ATS sees" tab shows the exact plain text a parser extracts — if it reads cleanly there, it reads cleanly in Workday, Greenhouse, Lever, and iCIMS. |
| **2026-aware scoring** | Semantic matching, no keyword stuffing (modern ATS penalize it), calibrated scores with the arithmetic explained — plus an instant, deterministic keyword scan that runs in your browser before any AI. |
| **Local-first privacy** | Your profile and history live in your browser's localStorage. The app does not write a server-side copy. One click erases everything. |
| **Job Inbox** | Save immutable, SHA-256-addressed posting snapshots; import CSV/JSON in bulk; skip duplicates by source ID, canonical URL, company/title/location, or description hash. |
| **Legitimate source connectors** | Import official Greenhouse and Lever public boards, USAJOBS searches, forwarded alerts, CSV/JSON, URLs, or manual text. LinkedIn/Indeed scraping and automated apply remain prohibited. |

## Features

- **Master profile** — paste or upload (PDF / .txt / .md) your resume once, plus an "everything else" field for projects, wins, and metrics that never fit on one page. Auto-saved locally.
- **Job by URL** — paste a careers-page link and the posting is fetched and extracted server-side (with a graceful fallback to paste for login-walled sites like LinkedIn).
- **Instant keyword scan** — deterministic, client-side coverage check the moment both fields are filled. Transparent baseline before the AI pass.
- **AI tailoring** — streaming analysis you can watch live, then: before/after match scores with rationale, classified change log, matched / honestly-added / not-added keywords, gap analysis with concrete advice, and ATS formatting checks.
- **Cover letter** — specific to your evidence and the posting, never generic filler.
- **Exports** — DOCX (ATS-safe single column), Markdown, plain text, print/PDF, one-click copy.
- **History** — past runs stored locally, reloadable, deletable.

## Quick start

```bash
git clone https://github.com/rblake2320/ai-resume-tailor-audit.git
cd ai-resume-tailor-audit
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Get an API key at [platform.claude.com](https://platform.claude.com/). The only required variable is `ANTHROPIC_API_KEY`; `RESUME_FOUNDRY_ANTHROPIC_MODEL` optionally overrides the default `claude-opus-5` without inheriting unrelated Claude CLI model aliases. `ANTHROPIC_MODEL` remains a lower-priority compatibility fallback.

The USAJOBS connector additionally reads `USAJOBS_API_KEY` and `USAJOBS_USER_AGENT`; Greenhouse and Lever public-board imports require no stored credentials.

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

CI runs lint, typecheck, tests, build, and a high-severity dependency audit on every push and PR.

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
  storage.ts               # localStorage profile + history
```

Design decisions worth knowing:

- **No database, no auth.** Deliberate: privacy is a feature and setup is `npm install` + one key. Profile and history persistence is client-side; generation requests still pass through the app server to Anthropic.
- **Structured outputs** (`output_config.format` with a strict JSON schema derived from Zod) guarantee a parseable result; the same Zod schema re-validates server-side.
- **Streaming NDJSON** from the tailor route: live thinking summaries (`thinking: adaptive, display: summarized`), progress ticks, then the final validated result.
- **Fonts are npm-installed** (Fraunces, Instrument Sans, JetBrains Mono via Fontsource) — builds are hermetic, no network font fetch.

## Roadmap

- Per-change accept/reject in the diff view
- Multiple named profiles
- Browser-extension job capture; LinkedIn partner-API import if/when access is granted
- Side-by-side original vs. tailored view

## License

[MIT](LICENSE)
