export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canReadCircular, canConfirmClassification, isChair } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular, getClassification, setFinal } from "@/lib/circulars/repo";
import { parseClassification } from "@/lib/circulars/classify";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const verdict = body?.verdict;
  if (verdict !== "confirmed" && verdict !== "corrected") {
    return NextResponse.json({ error: "invalid verdict" }, { status: 400 });
  }

  const parsed = parseClassification(body?.classification);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Authorise against the CIRCULAR's cell, never the cell inside the submitted
  // payload. Using parsed.value.primaryCell let any head rewrite another cell's
  // decision by submitting their own cell id — verified against the live API.
  if (!canConfirmClassification(actor, circular.cellId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // On an unrouted circular only the chair may decide; a head has no cell yet to
  // be authoritative for, and that is exactly the act of choosing one.
  if (circular.cellId === null && !isChair(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const prev = await getClassification(id);
  const now = Date.now();
  await setFinal(id, parsed.value, verdict, actor.user.id, now);

  const action = verdict === "confirmed" ? "classification.confirmed" : "classification.corrected";
  await audit({
    actorId: actor.user.id,
    action,
    entityType: "circular",
    entityId: id,
    cellId: circular.cellId,
    detail: { previousFinal: prev.final },
  });

  const classification = await getClassification(id);
  return NextResponse.json({ ok: true, classification });
}