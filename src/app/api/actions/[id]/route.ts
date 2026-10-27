export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canReadCircular, canCloseAction } from "@/lib/core/permissions";
import { isPrincipal } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular } from "@/lib/circulars/repo";
import { getAction, updateActionStatus } from "@/lib/meetings/repo";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const action = await getAction(id);
  if (!action) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const circular = await getCircular(action.circularId);
  if (!circular) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (isPrincipal(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canCloseAction(actor, action.ownerId, circular.cellId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = body?.status;
  if (status !== "open" && status !== "done") {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const updated = await updateActionStatus(id, status);

  await audit({
    actorId: actor.user.id,
    action: status === "done" ? "action.closed" : "action.reopened",
    entityType: "action",
    entityId: id,
    cellId: circular.cellId,
    detail: { status },
  });

  return NextResponse.json({ ok: true, action: updated });
}
