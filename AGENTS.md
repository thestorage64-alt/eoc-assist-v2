# AGENTS.md — eoc-v2

Read this before touching anything.

## What this is

A production-shaped rewrite of EOC Assist: cell-owned institutional work for the Equal
Opportunity Cell at HKBK College of Engineering. The previous app (`../EOC-Assist-App`) is
kept as reference only — it is built on the wrong ownership model (private, person-owned
circulars). Do not copy its authorization design.

**Never read** `D:\EOC Assist`, `D:\EOC Assist lite`, `D:\EOC Agent`, `D:\0New EOC`. They are
failed attempts and will poison the design.

## Commands

```
npm run dev         # :3001
npm run typecheck   # tsc --noEmit
npm test            # node:test suites
npm run verify      # typecheck + tests
node scripts/migrate.mjs
npm run db:seed     # users + memberships
node scripts/seed-demo.mjs --reset   # ten realistic circulars
```

## Stack rules

- Next.js App Router, React server components, TypeScript strict.
- PostgreSQL with **raw parameterised SQL**. No ORM.
- CSS variables + component styles. **No Tailwind. No CSS-in-JS.**
- No new dependencies without a written reason.
- `src/lib/contracts.ts` is the shared seam. Change it deliberately, never casually.

## The product rule

A circular belongs to a **cell**, not a person. Visibility is by cell membership; the chair
sees all 14; the principal sees everything read-only; confidential records are sealed to their
cell + chair + principal and return **404** to everyone else.

Authorization lives in `src/lib/core/permissions.ts` and is called by every route. Hiding a
button is never authorization.

## AI rule

The model may write `classifications.suggestion`. It may **never** write `final`, approve a
document, or advance a state. Invalid model output is rejected, not coerced. If the provider
is unavailable, say so and offer the manual path — never fake a suggestion.

## Definition of done

A task is done when its acceptance checks ran and passed, not when it compiles. For this
project that means: `npm run typecheck`, `npm test`, and the relevant journey against the
running app with real cookies. Report what you executed and what still fails.

## Demo accounts

Password `Eoc@2026` for all: `chair@`, `principal@`, `balaji@` (SC/ST head), `maaz@` (Minority
head), `member@` (SC/ST member, no confirm rights). Seeded by `npm run db:seed`.
