export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canCreateCircular, canReadCircular } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { createCircular, listCirculars } from "@/lib/circulars/repo";

export async function GET(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const cell = url.searchParams.get("cell");
  const q = url.searchParams.get("q");

  const circulars = await listCirculars(actor, { state, cell, q });
  return NextResponse.json({ ok: true, circulars });
}

export async function POST(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canCreateCircular(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(body?.title ?? "").trim();
  if (title.length < 3 || title.length > 200) {
    return NextResponse.json({ error: "title must be 3-200 chars" }, { status: 400 });
  }

  const confidential = Boolean(body?.confidential);
  const dueAtRaw = body?.due_at;
  const dueAt = dueAtRaw == null ? null : Number(dueAtRaw);

  const created = await createCircular(actor, {
    title,
    body: body?.body != null ? String(body.body) : "",
    source: body?.source != null ? String(body.source) : "",
    due_at: Number.isFinite(dueAt as number) ? dueAt : null,
    confidential,
    cell_id: body?.cell_id != null ? String(body.cell_id) : null,
  });

  await audit({
    actorId: actor.user.id,
    action: "circular.created",
    entityType: "circular",
    entityId: created.id,
    cellId: created.cellId,
    detail: { ref: created.ref },
  });

  return NextResponse.json({ ok: true, circular: created }, { status: 201 });
}