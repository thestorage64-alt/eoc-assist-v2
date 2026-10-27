export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canReadCircular, isChair, isPrincipal } from "@/lib/core/permissions";
import { cellRoleOf } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular, getActions } from "@/lib/circulars/repo";
import { createAction } from "@/lib/meetings/repo";
import { query } from "@/lib/core/db";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const actions = await getActions(id);
  return NextResponse.json({ ok: true, actions });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (isPrincipal(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const canCreate = isChair(actor) || cellRoleOf(actor, circular.cellId) === "head" || circular.assignedTo === actor.user.id;
  if (!canCreate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(body?.title ?? "").trim();
  if (title.length < 1 || title.length > 200) {
    return NextResponse.json({ error: "title must be 1-200 chars" }, { status: 400 });
  }

  let ownerId: string | null = null;
  if (body?.owner_id != null) {
    const oid = String(body.owner_id);
    const r = await query<any>("SELECT id FROM users WHERE id = $1 AND status = 'active'", [oid]);
    if ((r.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "invalid owner_id" }, { status: 400 });
    }
    ownerId = oid;
  }

  let dueAt: number | null = null;
  if (body?.due_at != null) {
    if (typeof body.due_at === "number") {
      dueAt = Number.isFinite(body.due_at) ? body.due_at : null;
    } else {
      const ms = Date.parse(String(body.due_at));
      dueAt = Number.isFinite(ms) ? ms : null;
    }
  }

  const action = await createAction(id, null, title, ownerId, dueAt);

  await audit({
    actorId: actor.user.id,
    action: "action.created",
    entityType: "action",
    entityId: action.id,
    cellId: circular.cellId,
    detail: { circularId: id },
  });

  return NextResponse.json({ ok: true, action }, { status: 201 });
}
