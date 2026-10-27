# Task 03 — command centre, reports, exports, audit

Depends on: `00-core`, `01-circulars`, `02-meetings`.
Working directory: `E:\GEARS Presentation project\eoc-v2`

Import `@/lib/core/*`, `@/lib/contracts`. Never edit them or other modules.

## Files you may create or edit

```
src/lib/insight/dashboard.ts
src/lib/insight/reports.ts
src/lib/insight/markdown.ts        circular → markdown, pure
src/lib/insight/docx.ts            markdown → DOCX
src/lib/insight/pdf.ts             markdown → PDF
src/app/api/dashboard/route.ts
src/app/api/reports/route.ts
src/app/api/reports/evidence/route.ts
src/app/api/circulars/[id]/export/route.ts
src/app/api/audit/route.ts
tests/insight.test.ts
```

## Behaviour

### `GET /api/dashboard`

Role-shaped `DashboardSummary` from contracts.
- **chair / principal**: institution-wide. `needsAttention` = overdue actions, unconfirmed
  classifications older than 24h, circulars in `intake` with no cell, in that priority order,
  max 8. `counts.byState` across all circulars. `cells` = all 14 with open/overdue counts.
- **head**: their cells only. **member**: their cells only.
- Confidential circulars follow `canReadCircular`; a principal/chair sees them, others don't.

### `GET /api/reports?from=&to=`

`ReportSummary` from contracts. Defaults: last 30 days. Aggregates must be computed in SQL.
`sdgCoverage` counts confirmed classifications per primary SDG. `perCell` per cell.

### `GET /api/reports/evidence?from=&to=`

Returns `text/markdown` with `Content-Disposition: attachment`:
sections — period, totals, per-cell table, decisions count, actions closed vs overdue,
SDG coverage table, and a chronological audit extract. This is the NAAC/NBA evidence pack.

### `GET /api/circulars/:id/export?format=pdf|docx|md`

- Readable by anyone who can read the circular (`canReadCircular`); principal allowed.
- `md`: the markdown from `markdown.ts`.
- `docx`: real OOXML via the `docx` package — heading, metadata table, body, classification,
  minutes, actions table, footer "EOC Assist · generated <date>".
- `pdf`: `pdfkit` stream to a Buffer — same content, A4, page numbers.
- Correct content types; `Content-Disposition` filename `EOC-<ref>.<ext>`.
- Exports must contain: the circular title, its ref, the confirmed cell **name** (not id),
  and every action with owner and due date.
- Audit `circular.exported` with the format.

### `GET /api/audit?entity_type=&entity_id=&limit=`

- Chair/principal: all. Head: their own cell only (`canReadAudit`). Member: 403.
- Newest first, default 50, max 200.

## Pure helpers — `markdown.ts`

`circularToMarkdown(detail, cellName, ownerNames)` → string. Deterministic, no AI.
Must render "Not specified" rather than inventing a value for missing fields.

## Tests — `tests/insight.test.ts`

1. markdown contains title, ref, cell name, and every action with owner + date
2. missing optional fields render "Not specified"
3. SDG table covers only SDGs present in the data
4. `docx` builder returns a Buffer starting with `PK` (zip signature)
5. `pdf` builder returns a Buffer starting with `%PDF`

## Acceptance

```
npm run typecheck && npm test
```
HTTP:
1. dashboard as chair → non-empty `needsAttention` or counts; as member → only their cells
2. reports for last 30 days → numbers match a direct SQL count you also run
3. evidence → 200 markdown containing "Per-cell" and the SDG table
4. export md/docx/pdf → 200, correct types, docx > 5 KB, pdf starts with `%PDF`
5. audit as member → 403; as chair → 200

Report actual outputs. Leave the dev server stopped.
