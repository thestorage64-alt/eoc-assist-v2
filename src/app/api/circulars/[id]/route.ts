export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canEditCircular, canReadCircular } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular, getClassification, getMeetings, getActions, getDocuments, updateCircular } from "@/lib/circulars/repo";
import type { CircularDetail } from "@/lib/contracts";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const classification = await getClassification(id);
  const meetings = await getMeetings(id);
  const actions = await getActions(id);
  const documents = await getDocuments(id);

  const detail: CircularDetail = {
    ...circular,
    classification,
    meetings,
    actions,
    documents,
  };
  return NextResponse.json({ ok: true, circular: detail });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canEditCircular(actor, { cellId: circular.cellId })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: { title?: string; body?: string; due_at?: number | null; assigned_to?: string | null } = {};
  const changed: string[] = [];

  if (body?.title !== undefined) {
    const title = String(body.title).trim();
    if (title.length < 3 || title.length > 200) {
      return NextResponse.json({ error: "title must be 3-200 chars" }, { status: 400 });
    }
    patch.title = title;
    changed.push("title");
  }
  if (body?.body !== undefined) {
    patch.body = String(body.body);
    changed.push("body");
  }
  if (body?.due_at !== undefined) {
    patch.due_at = body.due_at == null ? null : Number(body.due_at);
    changed.push("due_at");
  }
  if (body?.assigned_to !== undefined) {
    patch.assigned_to = body.assigned_to == null ? null : String(body.assigned_to);
    changed.push("assigned_to");
  }

  // reject unknown keys? Spec only editable. Ignore unknowns maybe. Fine.

  const updated = await updateCircular(id, patch);
  await audit({
    actorId: actor.user.id,
    action: "circular.updated",
    entityType: "circular",
    entityId: id,
    cellId: updated.cellId,
    detail: { changed },
  });

  return NextResponse.json({ ok: true, circular: updated });
}