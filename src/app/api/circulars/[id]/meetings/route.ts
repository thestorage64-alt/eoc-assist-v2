export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canReadCircular, cellRoleOf, isChair, isPrincipal } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular } from "@/lib/circulars/repo";
import { getMeetings } from "@/lib/circulars/repo";
import { createMeeting } from "@/lib/meetings/repo";
import { query } from "@/lib/core/db";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const meetings = await getMeetings(id);
  return NextResponse.json({ ok: true, meetings });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const canCreate = !isPrincipal(actor) && (isChair(actor) || cellRoleOf(actor, circular.cellId) === "head");
  if (!canCreate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let heldAt = body?.held_at;
  if (typeof heldAt === "string") heldAt = Date.parse(heldAt);
  if (heldAt == null) heldAt = Date.now();
  if (typeof heldAt !== "number" || !Number.isFinite(heldAt)) {
    return NextResponse.json({ error: "invalid held_at" }, { status: 400 });
  }

  const attendees = Array.isArray(body?.attendees) ? body.attendees.map((x: any) => String(x)) : [];
  if (attendees.length > 0) {
    const res = await query<any>("SELECT id FROM users WHERE id = ANY($1) AND status = 'active'", [attendees]);
    if ((res.rowCount ?? 0) !== attendees.length) {
      return NextResponse.json({ error: "invalid attendees", code: "invalid_attendees" }, { status: 400 });
    }
  }

  const notes = body?.notes != null ? String(body.notes) : "";
  const status = notes.trim().length > 0 ? "held" : "scheduled";

  const meeting = await createMeeting(actor, id, {
    heldAt,
    attendees,
    notes,
    status,
  });

  await audit({
    actorId: actor.user.id,
    action: "meeting.created",
    entityType: "meeting",
    entityId: meeting.id,
    cellId: circular.cellId,
    detail: { circularId: id },
  });

  return NextResponse.json({ ok: true, meeting }, { status: 201 });
}
