export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { buildEvidencePack } from "@/lib/insight/reports";

export async function GET(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const md = await buildEvidencePack(actor, from, to);
  const filename = "EOC-evidence.md";
  return new NextResponse(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
