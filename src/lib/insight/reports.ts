
import { query } from "@/lib/core/db";
import type { Actor, ReportSummary } from "@/lib/contracts";
import { CELL_SPEC } from "@/lib/contracts";
import { SDG_NAMES } from "@/lib/contracts";

function isWide(actor: Actor): boolean {
  return actor.user.role === "principal" || actor.user.role === "chair";
}

function cellIds(actor: Actor): string[] {
  if (isWide(actor)) return CELL_SPEC.map((c) => c.id);
  return actor.memberships.map((m) => m.cellId);
}

function toTs(v: any, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : fallback;
}

function scopeWhere(): string {
  return `((${isWidePlaceholder()}) ...)`;
}

function isWidePlaceholder(): string {
  return "TRUE";
}

export async function getReportSummary(
  actor: Actor,
  fromInput?: any,
  toInput?: any
): Promise<ReportSummary> {
  const now = Date.now();
  const defaultFrom = now - 30 * 24 * 60 * 60 * 1000;
  const from = toTs(fromInput, defaultFrom);
  const to = toTs(toInput, now);

  const wide = isWide(actor);
  const cells = cellIds(actor);
  const principal = actor.user.role === "principal";
  const chair = actor.user.role === "chair";
  const params4 = [principal, chair, actor.user.id, cells];

  const where = `(c.confidential = false OR $1::boolean OR $2::boolean OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $3 AND m.cell_id = c.cell_id)) AND ($1::boolean OR $2::boolean OR c.cell_id = ANY($4::text[]))`;

  const periodCond = `c.received_at >= $5 AND c.received_at <= $6`;
  const paramsPeriod = [...params4, from, to];

  // received
  const receivedRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM circulars c WHERE ${where} AND ${periodCond}`,
    paramsPeriod
  );
  // routed
  const routedRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM circulars c WHERE ${where} AND ${periodCond} AND c.state <> 'intake'`,
    paramsPeriod
  );
  // completed
  const completedRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM circulars c WHERE ${where} AND ${periodCond} AND c.state = 'done'`,
    paramsPeriod
  );
  // meetings
  const meetingsRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM meetings m JOIN circulars c ON c.id = m.circular_id
     WHERE ${where} AND m.held_at >= $5 AND m.held_at <= $6`,
    paramsPeriod
  );
  // actions open
  const actionsOpenRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM actions a JOIN circulars c ON c.id = a.circular_id
     WHERE ${where} AND ${periodCond} AND a.status = 'open'`,
    paramsPeriod
  );
  // actions overdue
  const nowParam = to + 0; // use current now? We'll pass now separately
  const actionsOverdueRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM actions a JOIN circulars c ON c.id = a.circular_id
     WHERE ${where} AND ${periodCond} AND a.status = 'open' AND a.due_at IS NOT NULL AND a.due_at < $7`,
    [...paramsPeriod, Date.now()]
  );

  // sdg coverage
  const sdgRes = await query<any>(
    `SELECT (cl.final->>'primarySdg')::int AS sdg, COUNT(*)::int AS cnt
     FROM circulars c JOIN classifications cl ON cl.circular_id = c.id
     WHERE ${where} AND ${periodCond} AND cl.final IS NOT NULL
     GROUP BY (cl.final->>'primarySdg')::int
     ORDER BY sdg`,
    paramsPeriod
  );
  const sdgCoverage = sdgRes.rows.map((r: any) => ({ sdg: Number(r.sdg), count: Number(r.cnt) }));

  // per cell
  const perCellRes = await query<any>(
    `SELECT cell_id,
       COUNT(*)::int AS received,
       COUNT(*) FILTER (WHERE state = 'done')::int AS completed
     FROM circulars c
     WHERE ${where} AND ${periodCond} AND cell_id IS NOT NULL
     GROUP BY cell_id`,
    paramsPeriod
  );
  const perCellMap = new Map<string, { received: number; completed: number }>();
  for (const r of perCellRes.rows) {
    perCellMap.set(r.cell_id, { received: Number(r.received ?? 0), completed: Number(r.completed ?? 0) });
  }
  const scopedCellSpecs = isWide(actor) ? CELL_SPEC : CELL_SPEC.filter((c) => cells.includes(c.id));
  const perCell = scopedCellSpecs.map((spec) => {
    const v = perCellMap.get(spec.id) ?? { received: 0, completed: 0 };
    return { cellId: spec.id, name: spec.name, received: v.received, completed: v.completed };
  });

  return {
    from,
    to,
    received: Number(receivedRes.rows[0]?.c ?? 0),
    routed: Number(routedRes.rows[0]?.c ?? 0),
    completed: Number(completedRes.rows[0]?.c ?? 0),
    meetings: Number(meetingsRes.rows[0]?.c ?? 0),
    actionsOpen: Number(actionsOpenRes.rows[0]?.c ?? 0),
    actionsOverdue: Number(actionsOverdueRes.rows[0]?.c ?? 0),
    sdgCoverage,
    perCell,
  };
}

export async function buildEvidencePack(actor: Actor, fromInput?: any, toInput?: any): Promise<string> {
  const now = Date.now();
  const defaultFrom = now - 30 * 24 * 60 * 60 * 1000;
  const from = toTs(fromInput, defaultFrom);
  const to = toTs(toInput, now);

  const summary = await getReportSummary(actor, from, to);

  const wide = isWide(actor);
  const cells = cellIds(actor);
  const principal = actor.user.role === "principal";
  const chair = actor.user.role === "chair";
  const params4 = [principal, chair, actor.user.id, cells];
  const where = `(c.confidential = false OR $1::boolean OR $2::boolean OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $3 AND m.cell_id = c.cell_id)) AND ($1::boolean OR $2::boolean OR c.cell_id = ANY($4::text[]))`;
  const paramsPeriod = [...params4, from, to];

  // decisions count
  const decRes = await query<any>(
    `SELECT COALESCE(SUM(jsonb_array_length(m.decisions)), 0)::int AS c
     FROM meetings m JOIN circulars c ON c.id = m.circular_id
     WHERE ${where} AND m.held_at >= $5 AND m.held_at <= $6`,
    paramsPeriod
  );
  const decisionsCount = Number(decRes.rows[0]?.c ?? 0);

  // actions closed
  const closedRes = await query<any>(
    `SELECT COUNT(*)::int AS c FROM actions a JOIN circulars c ON c.id = a.circular_id
     WHERE ${where} AND c.received_at >= $5 AND c.received_at <= $6 AND a.status = 'done'`,
    paramsPeriod
  );
  const closedCount = Number(closedRes.rows[0]?.c ?? 0);

  // audit extract
  const headCells = actor.memberships.filter((m) => m.role === "head").map((m) => m.cellId);
  let auditSql = `SELECT * FROM audit_events WHERE at >= $1 AND at <= $2`;
  const auditParams: any[] = [from, to];
  if (actor.user.role === "member") {
    // should not happen for evidence? but restrict
    auditSql += ` AND FALSE`;
  } else if (actor.user.role === "head") {
    if (headCells.length === 0) {
      auditSql += ` AND FALSE`;
    } else {
      auditParams.push(headCells);
      auditSql += ` AND cell_id = ANY($${auditParams.length}::text[])`;
    }
  }
  auditSql += ` ORDER BY at ASC LIMIT 100`;
  const auditRes = await query<any>(auditSql, auditParams);

  const lines: string[] = [];
  lines.push("# EOC Assist — Evidence Pack");
  lines.push("");
  lines.push("## Period");
  lines.push(`- From: ${new Date(from).toISOString()}`);
  lines.push(`- To: ${new Date(to).toISOString()}`);
  lines.push("");
  lines.push("## Totals");
  lines.push(`- Received: ${summary.received}`);
  lines.push(`- Routed: ${summary.routed}`);
  lines.push(`- Completed: ${summary.completed}`);
  lines.push(`- Meetings: ${summary.meetings}`);
  lines.push(`- Actions open: ${summary.actionsOpen}`);
  lines.push(`- Actions overdue: ${summary.actionsOverdue}`);
  lines.push("");
  lines.push("## Per-cell");
  lines.push("| Cell | Received | Completed |");
  lines.push("|---|---|---|");
  for (const pc of summary.perCell) {
    lines.push(`| ${pc.name} | ${pc.received} | ${pc.completed} |`);
  }
  lines.push("");
  lines.push("## Decisions");
  lines.push(`- Decisions recorded: ${decisionsCount}`);
  lines.push("");
  lines.push("## Actions");
  lines.push(`- Closed: ${closedCount}`);
  lines.push(`- Overdue: ${summary.actionsOverdue}`);
  lines.push("");
  lines.push("## SDG coverage");
  lines.push("| SDG | Name | Count |");
  lines.push("|---|---|---|");
  for (const s of summary.sdgCoverage) {
    lines.push(`| ${s.sdg} | ${SDG_NAMES[s.sdg] ?? "Unknown"} | ${s.count} |`);
  }
  lines.push("");
  lines.push("## Audit extract");
  if (auditRes.rows.length === 0) {
    lines.push("Not specified");
  } else {
    for (const e of auditRes.rows) {
      lines.push(`- ${new Date(Number(e.at)).toISOString()} ${e.action} ${e.entity_type ?? ""} ${e.entity_id ?? ""}`.trim());
    }
  }
  lines.push("");
  return lines.join("\n");
}

// aliases
export const getReport = getReportSummary;
export const getReports = getReportSummary;
export const generateReport = getReportSummary;
export const evidencePack = buildEvidencePack;
export const buildEvidence = buildEvidencePack;
export default getReportSummary;

