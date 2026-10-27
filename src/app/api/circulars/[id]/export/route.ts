export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canReadCircular } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { query } from "@/lib/core/db";
import { getCircular, getClassification, getMeetings, getActions, getDocuments } from "@/lib/circulars/repo";
import { circularToMarkdown } from "@/lib/insight/markdown";
import { markdownToDocx } from "@/lib/insight/docx";
import { markdownToPdf } from "@/lib/insight/pdf";
import { CELL_SPEC } from "@/lib/contracts";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") || "md").toLowerCase();
  if (!["md", "docx", "pdf"].includes(format)) {
    return NextResponse.json({ error: "Invalid format" }, { status: 400 });
  }

  const classification = await getClassification(id);
  const meetings = await getMeetings(id);
  const actions = await getActions(id);
  const documents = await getDocuments(id);
  const detail: any = { ...circular, classification, meetings, actions, documents };

  // cell name
  let cellName = "Not specified";
  if (circular.cellId) {
    const spec = CELL_SPEC.find((c) => c.id === circular.cellId);
    if (spec) cellName = spec.name;
    else {
      const r = await query<any>("SELECT name FROM cells WHERE id = $1", [circular.cellId]);
      if (r.rows[0]?.name) cellName = r.rows[0].name;
    }
  }

  // owner names
  const ownerIds = [...new Set(actions.map((a: any) => a.ownerId).filter(Boolean))] as string[];
  const ownerNames: Record<string, string> = {};
  if (ownerIds.length > 0) {
    const r = await query<any>("SELECT id, name FROM users WHERE id = ANY($1::text[])", [ownerIds]);
    for (const row of r.rows) ownerNames[row.id] = row.name;
  }

  const md = circularToMarkdown(detail, cellName, ownerNames);

  const safeRef = circular.ref.replace(/[^a-zA-Z0-9._-]/g, "_");

  if (format === "md") {
    await audit({ actorId: actor.user.id, action: "circular.exported", entityType: "circular", entityId: id, cellId: circular.cellId, detail: { format } });
    return new NextResponse(md, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="EOC-${safeRef}.md"`,
      },
    });
  }

  if (format === "docx") {
    const buffer = await markdownToDocx(md);
    await audit({ actorId: actor.user.id, action: "circular.exported", entityType: "circular", entityId: id, cellId: circular.cellId, detail: { format } });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="EOC-${safeRef}.docx"`,
      },
    });
  }

  // pdf
  const buffer = await markdownToPdf(md);
  await audit({ actorId: actor.user.id, action: "circular.exported", entityType: "circular", entityId: id, cellId: circular.cellId, detail: { format } });
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="EOC-${safeRef}.pdf"`,
    },
  });
}
