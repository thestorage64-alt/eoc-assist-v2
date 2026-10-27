export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canReadCircular, canSignMinutes as canSignMinutesPerm } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular } from "@/lib/circulars/repo";
import { getMeeting, signMeeting } from "@/lib/meetings/repo";
import { resolveOwner } from "@/lib/meetings/minutes";
import { query } from "@/lib/core/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const meeting = await getMeeting(id);
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const circular = await getCircular(meeting.circularId);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canSignMinutesPerm(actor, circular.cellId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!meeting.minutesMd || meeting.minutesMd.trim().length === 0) {
    return NextResponse.json({ error: "minutes_required", code: "minutes_required" }, { status: 400 });
  }

  const proposed = meeting.proposedActions ?? [];

  const usersRes = await query<any>("SELECT id, name FROM users WHERE status = 'active'");
  const users = usersRes.rows.map((r: any) => ({ id: r.id, name: r.name }));

  const enriched = proposed.map((pa: any) => {
    const r = resolveOwner(pa?.ownerName, users);
    let dueAt: number | null = null;
    if (pa?.dueDate) {
      const ms = Date.parse(String(pa.dueDate) + "T00:00:00.000Z");
      dueAt = Number.isFinite(ms) ? ms : null;
    }
    return { title: String(pa?.title ?? ""), ownerId: r.id, dueAt };
  });

  const actions = await signMeeting(meeting.id, actor.user.id, enriched);

  await audit({
    actorId: actor.user.id,
    action: "minutes.signed",
    entityType: "meeting",
    entityId: meeting.id,
    cellId: circular.cellId,
    detail: { actions: actions.length },
  });

  return NextResponse.json({ ok: true, actions });
}
