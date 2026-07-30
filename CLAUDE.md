# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Resume Foundry — an honest AI resume-tailoring web app. Users save a master profile (resume + extra background) locally, provide a job posting (text or URL), and get a tailored resume + cover letter with match scores, a classified change diff, keyword honesty accounting, gap analysis, and ATS checks. Single Next.js app, no database, no auth — all user data is browser localStorage.

## Commands

```bash
npm run dev        # dev server (Turbopack)
npm run build      # production build — must stay green
npm start          # serve production build
npm test           # vitest — unit tests live next to sources in lib/*.test.ts
npm run lint       # eslint flat config (typescript-eslint + @next/eslint-plugin-next + react-hooks)
npm run typecheck  # tsc --noEmit
```

Run all four checks (lint, typecheck, test, build) before considering any change done. CI enforces them plus `npm audit --audit-level=high`.

Requires `ANTHROPIC_API_KEY` in `.env.local` (see `.env.example`) for the tailor endpoint; everything else works without it.

## Architecture

- `app/api/tailor/route.ts` — the core AI call. Claude **Opus 5** (`claude-opus-5`, overridable via `ANTHROPIC_MODEL`) through `client.beta.messages.stream` with: adaptive thinking (`display: "summarized"` streamed to the client), **structured outputs** (`output_config.format` = JSON schema generated from Zod in `lib/schema.ts`), and the server-side refusal fallback beta (`fallbacks: "default"`). Response is NDJSON: `thinking` / `progress` / `result` / `error` events.
- `lib/schema.ts` — single source of truth for the result shape. `TailorResultSchema` (Zod) → `tailorResultJsonSchema()` strips numeric constraints (unsupported by structured outputs) and keeps `additionalProperties: false` everywhere. The schema's `.describe()` strings are prompt-load-bearing — they instruct the model.
- `lib/prompts.ts` — the honesty rules and 2026 ATS knowledge (semantic matching, anti-stuffing, anti-AI-voice). Changes here change product behavior more than any code.
- `lib/ats.ts` — deterministic, dependency-free keyword extraction + coverage scan; runs client-side as the transparent "instant scan" baseline. Fully unit-tested.
- `lib/html.ts` + `app/api/fetch-job/route.ts` — job-by-URL. Dependency-free HTML→text, SSRF guard (blocks private hosts), 15s timeout, graceful "paste instead" errors for login-walled sites.
- `lib/markdown.ts` — tiny md→HTML (escapes first — keep it injection-safe) and md→plain-text ("What the ATS sees" tab + .txt export).
- `lib/docx-export.ts` — md→DOCX via the `docx` package, ATS-safe single column. Client-side.
- `lib/storage.ts` — localStorage profile/history. Never add server-side persistence of user content without an explicit decision; local-first privacy is a core product promise.
- `app/page.tsx` — the whole UI. Hydration pattern: lazy `useState` initializers read localStorage; a `useSyncExternalStore` gate avoids SSR mismatch; the autosave effect only calls setState inside its timer callback (the react-hooks `set-state-in-effect` rule is enforced — don't reintroduce sync setState in effects).

## Conventions

- **Honesty is the product.** Any change to prompts, schema, or UI must preserve: no fabricated skills/dates/metrics; `keywords.not_added` must remain populated and visible; scores stay calibrated (rationale explains arithmetic).
- TypeScript is pinned `<6.1` (typescript-eslint peer range). Don't bump to TS 7 until typescript-eslint supports it.
- `package.json` `overrides` pin patched transitive deps; `npm audit` must stay at 0 relevant findings. Don't remove overrides without re-auditing.
- Fonts are self-hosted via Fontsource imports in `app/layout.tsx` — don't switch to `next/font/google` (breaks hermetic builds).
- Design system lives in `app/globals.css` `@theme` tokens (ink/paper/brass). Documents render on `.sheet` (paper); chrome stays ink. Keep that contrast.
- New pure logic goes in `lib/` with a `*.test.ts` beside it.
