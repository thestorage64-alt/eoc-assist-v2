# Task 01 — circulars, classification, routing

Depends on: `00-core` (must be green before you start).
Working directory: `E:\GEARS Presentation project\eoc-v2`

`src/lib/contracts.ts` is frozen. `src/lib/core/*` belongs to core — you may import it,
never edit it.

## Files you may create or edit

```
src/lib/circulars/repo.ts          data access (raw SQL only, parameterised)
src/lib/circulars/state.ts         transition rules, pure
src/lib/circulars/classify.ts      validation of a Classification object, pure
src/lib/circulars/prompt.ts        prompt construction, pure
src/lib/ai/client.ts               OpenAI-compatible transport
src/app/api/circulars/route.ts                 GET list, POST create
src/app/api/circulars/[id]/route.ts            GET detail, PATCH
src/app/api/circulars/[id]/classify/route.ts   POST suggest
src/app/api/circulars/[id]/confirm/route.ts    POST human decision
src/app/api/circulars/[id]/transition/route.ts POST advance
tests/circulars.test.ts
```

Do not touch: `src/lib/core/**`, `src/lib/contracts.ts`, any route outside `/api/circulars`,
any UI.

## Behaviour

### Create — `POST /api/circulars`

Body: `{ title, body?, source?, due_at?, confidential?, cell_id? }`.
- `title` required, 3–200 chars. `body` optional (may be pasted text).
- `ref` generated as `EOC-<year>-<zero-padded sequence>` (sequence = count for that year + 1),
  unique. Retry once on unique violation.
- `state` starts at `intake`. `created_by` = actor. `received_at`/`created_at`/`updated_at` = now.
- `confidential: true` is allowed; only the cell it is routed to, the chair and the principal
  may read it afterwards.
- **Gate:** `canCreateCircular(actor)`; the principal must get 403.
- Audit: `circular.created`.

### List — `GET /api/circulars?state=&cell=&q=`

- Visibility is enforced **in SQL**, not by filtering in JS: a non-confidential circular is
  visible to any signed-in actor; a confidential one only to its cell's members, the chair,
  the principal.
- Returns `{ ok, circulars: Circular[] }`, newest first, limit 100.
- `q` matches title or body, case-insensitive.

### Detail — `GET /api/circulars/:id`

- 404 if not visible (never 403 — existence is not disclosed).
- Returns `CircularDetail` (classification record, meetings, actions, documents).

### Patch — `PATCH /api/circulars/:id`

- Only `title`, `body`, `due_at`, `assigned_to` are editable.
- `canEditCircular(actor, circular)`; otherwise 403 (the actor can already see it).
- Audit: `circular.updated` with the changed keys.

### Suggest — `POST /api/circulars/:id/classify`

- Actor must be able to read it and must not be the principal.
- Requires `body` (or title) with at least 40 characters, else 400.
- Calls the AI client; stores the validated result in `classifications.suggestion`.
  **Never writes `final`.**
- Returns `{ ok, suggestion }`.
- Failure modes, each explicit: 503 `ai_not_configured`, 504 `ai_timeout`,
  502 `ai_failed`, 422 `ai_invalid_output`. On any failure the previous suggestion is kept.
- Audit: `classification.suggested` (or `.failed` with the reason).

### Confirm — `POST /api/circulars/:id/confirm`

Body: `{ classification, verdict: "confirmed" | "corrected" }`.
- `canConfirmClassification(actor, classification.primaryCell)`; a member gets 403.
- Validates the object strictly (see below), writes `final`, `verdict`, `decided_by`,
  `decided_at`. Suggestion is untouched.
- Audit: `classification.confirmed` or `.corrected`, with the previous final if any.

### Transition — `POST /api/circulars/:id/transition` body `{ to }`

- `canAdvance`; illegal edge ⇒ 400 with the reason.
- `intake → route` requires `final` to exist **and** sets `cell_id = final.primaryCell`
  and `assigned_to` = that cell's head (if unassigned).
- `report → done` requires an approved final report document; if none, 400.
- Other edges must follow `NEXT_STATE` exactly.
- Audit: `circular.transitioned` with `{from,to}`.

## Validation — `classify.ts`

`parseClassification(value): { ok: true; value: Classification } | { ok: false; error: string }`

- `primaryCell` must be one of `CELL_SPEC` ids.
- `relatedCells` ⊆ `CELL_SPEC` ids, no duplicates, must not include `primaryCell`.
- `primarySdg` integer 1–17; `relatedSdgs` within 1–17, no duplicates, ≠ primary.
- `confidence` ∈ high|medium|low.
- `reason` 20–600 chars, non-empty after trim.
- `tags` ≤ 8 strings, each ≤ 32 chars.
- **Reject unknown keys.** A model reply containing `final` or `verdict` is invalid.

## AI client — `src/lib/ai/client.ts`

- Reads `EOC_LLM_BASE_URL` (default `https://api.groq.com/openai/v1`), `EOC_LLM_API_KEY`
  (or `GROQ_API_KEY`), `EOC_LLM_MODEL` (default `openai/gpt-oss-120b`), `EOC_LLM_TIMEOUT_MS`.
- `POST {base}/chat/completions`, `response_format: { type: "json_object" }`,
  `temperature: 0`, `max_tokens: 700`.
- 30s timeout via `AbortSignal.timeout`. One retry only on 429/5xx, with 1s backoff.
- Never log or return the key; redact any `sk-`/`gsk_` substring from error text.
- Throw typed errors: `AiNotConfigured`, `AiTimeout`, `AiFailed`, `AiInvalidOutput`.

## Prompt — `prompt.ts`

System prompt must contain the 14 cell ids with names and the 17 SDG numbers with names, and
demand a single JSON object with exactly the `Classification` keys, no prose. Include two
few-shot examples. Keep it deterministic.

## Tests — `tests/circulars.test.ts`

Pure tests only (no DB):
1. `parseClassification` accepts a valid object.
2. Rejects an unknown cell id.
3. Rejects SDG 0, 18, 4.5 and unknown keys.
4. Rejects a payload containing `final` or `verdict`.
5. `relatedCells` may not contain `primaryCell`.
6. Transition table: legal edge accepted, illegal edge rejected, `intake→route` requires final,
   `report→done` requires an approved report.
7. `buildPrompt` includes all 14 cell ids and all 17 SDG numbers.

## Acceptance (run and paste actual output)

```
npm run typecheck
npm test
```
Then against the running dev server with a chair cookie:

1. create a circular with the UGC scholarship text → 201, ref `EOC-2026-0001`
2. `POST /classify` → 200 with a suggestion; then `GET` detail shows `final: null`
3. `POST /confirm` as a **member** (member@hkbk.edu.in) → **403**
4. `POST /confirm` as the chair → 200; detail shows `final` and `verdict`
5. `POST /transition {to:"route"}` → 200; circular now has `cell_id` and `assigned_to`
6. `POST /transition {to:"convene"}` on a fresh intake circular → 400 (gate works)
7. create a `confidential` circular, read it as `member@hkbk.edu.in` (cell_01, not its cell)
   → **404**

If the AI key is absent, say so and prove the 503 path instead — do not fake a suggestion.
