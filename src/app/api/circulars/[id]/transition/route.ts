export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canAdvance, canReadCircular } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular, getClassification, hasApprovedReport, getCellHead, updateCircular } from "@/lib/circulars/repo";
import { query } from "@/lib/core/db";
import { NEXT_STATE, isState } from "@/lib/contracts";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canAdvance(actor, { cellId: circular.cellId })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = body?.to;
  if (!isState(to)) {
    return NextResponse.json({ error: "invalid state" }, { status: 400 });
  }

  const from = circular.state;
  const cls = await getClassification(id);

  // intake -> route gated
  if (from === "intake" && to === "route") {
    if (!cls.final) {
      return NextResponse.json({ error: "intake->route requires a final classification" }, { status: 400 });
    }
    const primaryCell = cls.final.primaryCell;
    const patch: { state: any; cell_id?: string; assigned_to?: string | null } = { state: to };
    const updates: any = { state: to };
    // We'll handle via updateCircular with cell/assigned separately by direct query? updateCircular doesn't support state/cell_id. Need extend? 
    // Use query directly for state/cell_id/assigned_to.
    let assignedTo = circular.assignedTo;
    if (!assignedTo) {
      assignedTo = await getCellHead(primaryCell);
    }
    await query(
      "UPDATE circulars SET state = $1, cell_id = $2, assigned_to = $3, updated_at = $4 WHERE id = $5",
      [to, primaryCell, assignedTo, Date.now(), id]
    );
    await audit({
      actorId: actor.user.id,
      action: "circular.transitioned",
      entityType: "circular",
      entityId: id,
      cellId: primaryCell,
      detail: { from, to },
    });
    const updated = await getCircular(id);
    return NextResponse.json({ ok: true, circular: updated });
  }

  // report -> done gated
  if (from === "report" && to === "done") {
    const ok = await hasApprovedReport(id);
    if (!ok) {
      return NextResponse.json({ error: "report->done requires an approved report document" }, { status: 400 });
    }
    if (NEXT_STATE[from] !== to && !(from === "report" && to === "done")) {
      // fall through
    }
    await query("UPDATE circulars SET state = $1, updated_at = $2 WHERE id = $3", [to, Date.now(), id]);
    await audit({
      actorId: actor.user.id,
      action: "circular.transitioned",
      entityType: "circular",
      entityId: id,
      cellId: circular.cellId,
      detail: { from, to },
    });
    const updated = await getCircular(id);
    return NextResponse.json({ ok: true, circular: updated });
  }

  // other edges
  if (NEXT_STATE[from as keyof typeof NEXT_STATE] !== to) {
    return NextResponse.json({ error: `illegal transition ${from} -> ${to}` }, { status: 400 });
  }

  await query("UPDATE circulars SET state = $1, updated_at = $2 WHERE id = $3", [to, Date.now(), id]);
  await audit({
    actorId: actor.user.id,
    action: "circular.transitioned",
    entityType: "circular",
    entityId: id,
    cellId: circular.cellId,
    detail: { from, to },
  });
  const updated = await getCircular(id);
  return NextResponse.json({ ok: true, circular: updated });
}