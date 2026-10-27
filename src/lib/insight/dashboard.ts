
import { query } from "@/lib/core/db";
import type { Actor, DashboardSummary } from "@/lib/contracts";
import { CELL_SPEC } from "@/lib/contracts";

function isWide(actor: Actor): boolean {
  return actor.user.role === "principal" || actor.user.role === "chair";
}

function cellIds(actor: Actor): string[] {
  if (isWide(actor)) return CELL_SPEC.map((c) => c.id);
  return actor.memberships.map((m) => m.cellId);
}

function baseParams(actor: Actor, now: number): any[] {
  return [
    actor.user.role === "principal",
    actor.user.role === "chair",
    actor.user.id,
    cellIds(actor),
  ];
}

function scopeWhere(alias = "c"): string {
  return `((${alias}.confidential = false OR $1::boolean OR $2::boolean OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $3 AND m.cell_id = ${alias}.cell_id)))
    AND (${isWidePlaceholder()} OR ${alias}.cell_id = ANY($4::text[]))`;
}

// placeholder resolved per call; use function returning based on actor? We'll inline instead.
function isWidePlaceholder(): string {
  return "($1::boolean OR $2::boolean)";
}

export async function getDashboard(actor: Actor): Promise<DashboardSummary> {
  const now = Date.now();
  const wide = isWide(actor);
  const cells = cellIds(actor);
  const principal = actor.user.role === "principal";
  const chair = actor.user.role === "chair";
  const params4 = [principal, chair, actor.user.id, cells];

  const baseWhere = `((${wide ? "TRUE" : "FALSE"} OR c.confidential = false OR $1::boolean OR $2::boolean OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $3 AND m.cell_id = c.cell_id)) AND (TRUE OR c.cell_id = ANY($4::text[])))`;
  // Simpler: build explicit
  const where = `(c.confidential = false OR $1::boolean OR $2::boolean OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $3 AND m.cell_id = c.cell_id)) AND ($1::boolean OR $2::boolean OR c.cell_id = ANY($4::text[]))`;

  // 1. overdue actions
  const overdueRes = await query<any>(
    `SELECT DISTINCT ON (c.id) c.id, c.title, c.due_at, a.due_at AS action_due
     FROM circulars c
     JOIN actions a ON a.circular_id = c.id
     WHERE ${where}
       AND a.status = 'open' AND a.due_at IS NOT NULL AND a.due_at < $5
     ORDER BY c.id, a.due_at ASC`,
    [...params4, now]
  );
  const overdueRows = overdueRes.rows.sort((a: any, b: any) => Number(a.action_due) - Number(b.action_due));

  // 2. unconfirmed classifications older than 24h
  const unconfRes = await query<any>(
    `SELECT c.id, c.title, c.due_at
     FROM circulars c
     LEFT JOIN classifications cl ON cl.circular_id = c.id
     WHERE ${where}
       AND cl.final IS NULL
       AND c.created_at < $5::bigint - 86400000
     ORDER BY c.created_at ASC
     LIMIT 8`,
    [...params4, now]
  );

  // 3. intake with no cell
  const intakeRes = await query<any>(
    `SELECT c.id, c.title, c.due_at
     FROM circulars c
     WHERE ${where}
       AND c.state = 'intake' AND c.cell_id IS NULL
     ORDER BY c.created_at ASC
     LIMIT 8`,
    params4
  );

  const seen = new Set<string>();
  const needsAttention: DashboardSummary["needsAttention"] = [];
  function push(rows: any[], reason: string) {
    for (const r of rows) {
      if (needsAttention.length >= 8) break;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      needsAttention.push({
        circularId: r.id,
        title: r.title,
        reason,
        dueAt: r.due_at == null ? null : Number(r.due_at),
      });
    }
  }
  push(overdueRows, "Overdue action");
  push(unconfRes.rows, "Unconfirmed classification");
  push(intakeRes.rows, "Intake without cell");

  // counts
  const byStateRes = await query<any>(
    `SELECT state, COUNT(*)::int AS c FROM circulars c WHERE ${where} GROUP BY state`,
    params4
  );
  const byState: Record<string, number> = {};
  for (const s of ["intake","route","convene","pre_meeting","meeting","implement","verify","report","done"]) {
    byState[s] = 0;
  }
  for (const r of byStateRes.rows) byState[r.state] = Number(r.c);

  const openRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM circulars c WHERE ${where} AND state <> 'done'`,
    params4
  );
  const overdueCircRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM circulars c WHERE ${where} AND state <> 'done' AND due_at IS NOT NULL AND due_at < $5`,
    [...params4, now]
  );

  // cell aggregates
  const cellAggRes = await query<any>(
    `SELECT cell_id,
       COUNT(*) FILTER (WHERE state <> 'done')::int AS open,
       COUNT(*) FILTER (WHERE state <> 'done' AND due_at IS NOT NULL AND due_at < $5)::int AS overdue
     FROM circulars c
     WHERE ${where} AND cell_id IS NOT NULL
     GROUP BY cell_id`,
    [...params4, now]
  );
  const aggMap = new Map<string, { open: number; overdue: number }>();
  for (const r of cellAggRes.rows) {
    aggMap.set(r.cell_id, { open: Number(r.open ?? 0), overdue: Number(r.overdue ?? 0) });
  }

  const scopedCellSpecs = wide ? CELL_SPEC : CELL_SPEC.filter((c) => cells.includes(c.id));
  const cellsOut = scopedCellSpecs.map((spec) => {
    const a = aggMap.get(spec.id) ?? { open: 0, overdue: 0 };
    return { cellId: spec.id, name: spec.name, open: a.open, overdue: a.overdue };
  });

  return {
    needsAttention,
    counts: {
      byState,
      open: Number(openRes.rows[0]?.c ?? 0),
      overdue: Number(overdueCircRes.rows[0]?.c ?? 0),
    },
    cells: cellsOut,
  };
}

export const getDashboardSummary = getDashboard;
export const buildDashboard = getDashboard;
export default getDashboard;
