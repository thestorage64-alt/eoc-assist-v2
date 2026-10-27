# Task 02 — meetings, minutes, actions

Depends on: `00-core` and `01-circulars`.
Working directory: `E:\GEARS Presentation project\eoc-v2`

Import `@/lib/core/*` and `@/lib/contracts`. Never edit them, never edit `src/lib/circulars/**`.

## Files you may create or edit

```
src/lib/meetings/repo.ts
src/lib/meetings/minutes.ts          pure derivation + validation
src/lib/meetings/prompt.ts           minutes prompt, pure
src/app/api/circulars/[id]/meetings/route.ts     GET list, POST create
src/app/api/meetings/[id]/minutes/route.ts       POST generate
src/app/api/meetings/[id]/sign/route.ts          POST sign
src/app/api/circulars/[id]/actions/route.ts      GET list, POST create
src/app/api/actions/[id]/route.ts                PATCH status
tests/minutes.test.ts
```

## Behaviour

### Create meeting — `POST /api/circulars/:id/meetings`

Body `{ held_at, attendees?: string[], notes?: string }`.
- Actor must be able to read the circular; only chair or head of its cell may create.
- `attendees` are `user_id`s (validate they exist and are active).
- `status = "held"` if `notes` present, else `"scheduled"`.
- Audit `meeting.created`.

### Generate minutes — `POST /api/meetings/:id/minutes`

Body `{ notes?: string }` (falls back to stored notes).
- Requires chair or head of the circular's cell.
- Notes shorter than 40 chars → 400 `notes_too_short`.
- Calls the AI with a strict schema:

```json
{ "minutes_md": "markdown", "decisions": ["..."],
  "proposed_actions": [{ "title": "...", "owner_name": "...", "due_date": "YYYY-MM-DD" }] }
```

- Validation: `minutes_md` 100–8000 chars; 1–12 decisions; 0–12 actions; each action title
  5–160 chars; `due_date` valid ISO date or null; `owner_name` free text (resolved later).
- Stores `minutes_md`, `decisions`, `status="held"`. **Does not create actions yet.**
- Errors mirror the classify route: 503/504/502/422 with the same codes.
- Audit `minutes.generated`.

### Sign — `POST /api/meetings/:id/sign`

- Chair or head only.
- Requires non-empty `minutes_md`, else 400.
- In one transaction: `status="signed"`, `signed_by`, `signed_at`, then insert one `actions`
  row per `proposed_actions` entry, resolving `owner_name` against `users.name`
  (case-insensitive; if no match or ambiguous, `owner_id = null` and the row is still created).
- Returns `{ ok, actions }`.
- Audit `minutes.signed` with the action count.

### Actions

- `GET /api/circulars/:id/actions` — readable with the circular.
- `POST` — chair/head, or the current assignee; `{ title, owner_id?, due_at? }`.
- `PATCH /api/actions/:id` `{ status: "open"|"done" }` — owner, cell head, or chair.
  Setting `done` stamps `completed_at`; setting `open` clears it.
  Principal always 403.
- Audit `action.created` / `action.closed` / `action.reopened`.

## Pure rules — `minutes.ts`

- `parseMinutes(value)` — strict validation of the JSON above, unknown keys rejected.
- `resolveOwner(name, users)` → `{ id: string | null, ambiguous: boolean }`, case-insensitive
  trimmed match on full name; multiple matches ⇒ ambiguous, id null.
- `deriveFallbackMinutes(notes)` — deterministic, used only when the AI is unavailable:
  one bullet per sentence containing "will", "agreed", "action" or "by"; decisions = those
  sentences; proposed actions extract a trailing date (`15 Nov`, `2026-11-15`) when present.
  The UI must label this "rule-based".

## Tests — `tests/minutes.test.ts`

1. valid payload accepted; unknown key rejected; empty decisions rejected
2. action title too short / too long rejected
3. bad due_date rejected; null accepted
4. `resolveOwner` exact, case-insensitive, ambiguous, missing
5. `deriveFallbackMinutes` extracts decisions and at least one dated action from sample notes
6. signing with empty minutes is refused (pure guard function)

## Acceptance

```
npm run typecheck && npm test
```
HTTP, with chair and head cookies:
1. create a meeting on an existing routed circular → 201
2. generate minutes from notes → 200 with minutes + decisions + proposed actions
3. sign → 200, actions created, `GET /actions` returns them with owner + due date
4. a cell member who is not the owner PATCHes an action → 403
5. the owner PATCHes it to `done` → 200 and `completed_at` set
6. principal PATCHes anything → 403

Report actual outputs. Leave the dev server stopped.
