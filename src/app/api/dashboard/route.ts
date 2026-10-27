export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { getDashboard } from "@/lib/insight/dashboard";

export async function GET(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const summary = await getDashboard(actor);
  return NextResponse.json({ ok: true, dashboard: summary, ...summary });
}
