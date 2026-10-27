export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { query } from "@/lib/core/db";
import type { Cell } from "@/lib/contracts";

export async function GET(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cellsRes = await query<any>(`
    SELECT c.id, c.number, c.name, c.mandate,
      h.id AS head_id, h.name AS head_name,
      COALESCE(o.cnt, 0)::int AS open_count
    FROM cells c
    LEFT JOIN memberships m ON m.cell_id = c.id AND m.role = 'head'
    LEFT JOIN users h ON h.id = m.user_id
    LEFT JOIN (
      SELECT cell_id, COUNT(*)::int AS cnt FROM circulars
      WHERE state <> 'done' GROUP BY cell_id
    ) o ON o.cell_id = c.id
    ORDER BY c.number
  `);

  const cells: Cell[] = cellsRes.rows.map((r: any) => ({
    id: r.id,
    number: r.number,
    name: r.name,
    mandate: r.mandate,
    head: r.head_id ? { id: r.head_id, name: r.head_name } : null,
    openCirculars: Number(r.open_count ?? 0),
  }));

  return NextResponse.json({ ok: true, cells });
}
