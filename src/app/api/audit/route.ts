export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { query } from "@/lib/core/db";

export async function GET(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (actor.user.role === "member") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entity_type");
  const entityId = url.searchParams.get("entity_id");
  let limit = parseInt(url.searchParams.get("limit") || "50", 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  const params: any[] = [];
  let where = "TRUE";
  if (entityType) {
    params.push(entityType);
    where += ` AND entity_type = $${params.length}`;
  }
  if (entityId) {
    params.push(entityId);
    where += ` AND entity_id = $${params.length}`;
  }

  if (actor.user.role === "head") {
    const cells = actor.memberships.filter((m) => m.role === "head").map((m) => m.cellId);
    if (cells.length === 0) {
      return NextResponse.json({ ok: true, events: [] });
    }
    params.push(cells);
    where += ` AND cell_id = ANY($${params.length}::text[])`;
  }

  params.push(limit);
  const sql = `SELECT * FROM audit_events WHERE ${where} ORDER BY at DESC LIMIT $${params.length}`;
  const res = await query<any>(sql, params);

  const events = res.rows.map((r: any) => ({
    id: r.id,
    actorId: r.actor_id ?? null,
    action: r.action,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    cellId: r.cell_id ?? null,
    detail: typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail ?? {},
    at: Number(r.at),
  }));

  return NextResponse.json({ ok: true, events });
}
