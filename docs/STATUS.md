# eoc-v2 — status

## Running it now

```
cd "E:\GEARS Presentation project\eoc-v2"
npm run dev            # http://localhost:3001
```

Postgres: container `eoc-v2-pg` on `localhost:55433` (db `eoc`, user `postgres`, pw `eoc`).
Sign in as `chair@hkbk.edu.in` / `Eoc@2026`.

## What is built and verified

| Area | Evidence |
|---|---|
| Schema, 11 tables, migrations 001–002 | applied; 14 cells, 11 users, 15 memberships |
| Auth (scrypt, hashed session tokens, HttpOnly cookie) | login 200, signed-out `/command` → 307 `/login` |
| Permissions (member / head / chair / principal, sealed records) | 32 unit tests; member confirm → 403; outsider sealed read → 404 |
| Circulars: create, list, detail, patch, transition | live: ref generated, gate blocks `intake→route` without a final |
| AI classification (Groq, strict schema) | live suggestion: **cell_04 Minority Cell, SDG 4, related 10, high confidence**, reason quoted from the circular |
| Confirm / correct | chair 200 with the record returned; member 403 |
| Meetings, minutes, actions | minutes generated from notes → 3 decisions, 3 actions with owners and dates; signing persists them |
| Command centre, circulars, detail, workflow, cells, reports | all render real data in a browser at 1440×900 |
| Exports | PDF/DOCX/MD produce real bytes |
| Demo data | 10 realistic circulars across the lifecycle, one sealed POSH record, one signed meeting with four actions, one completed report |

### File intake and voice (added)

| Capability | Evidence |
|---|---|
| PDF → text | real 2-page PDF: 2,536 chars extracted, method `pdf`, page count returned |
| Word → text | real `.docx`: 19,299 chars extracted |
| Text/Markdown | read as-is |
| Image → text | vision model (`EOC_VISION_MODEL`, default llama-4-scout); returns method `vision`; fails honestly if unavailable |
| Scanned PDF | refused with a clear message rather than returning empty text |
| Audio → notes | Whisper `whisper-large-v3`: a real 835 KB WAV transcribed accurately with names and dates |
| Manual minutes | `Record by hand` produces decisions and actions without the provider |

All uploads are authenticated, size-limited (10 MB files / 24 MB audio), type-checked, and
extracted text lands in an editable box — nothing is saved until a human presses Create.

`npm run typecheck` clean. `npm test` 32/32.

## Not done yet

- **Hosted deployment.** Local only so far. Vercel + hosted Postgres is the remaining task;
  the code is env-driven and has no localhost assumptions.
- **Mobile 375px pass** in a browser (CSS is written for it; not yet verified visually).
- **Login page** not yet inspected visually.
- J3/J4 were verified at the API level, not clicked through in a browser.
- Nav still shows two features as unbuilt if any remain; nothing should be a dead link.

## Design decisions worth knowing

- Circulars are cell-owned. `cell_id` + `assigned_to`; visibility by membership, not by creator.
- Principal is read-only **at the server**, not by hiding buttons.
- Sealed records return 404 to outsiders — existence is not disclosed.
- Suggestions and decisions are separate columns (`classifications.suggestion` / `.final`).
- Proposed meeting actions persist in `meetings.proposed_actions` until signing creates rows.
- The deck (`EOC_Assist_GEARS2026_FINAL.pptx`) is the product contract; if the app diverges,
  decide deliberately which one changes.
