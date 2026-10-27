import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { actorFromSession } from "../actor";
import { query } from "@/lib/core/db";
import { Page, Card, Pill, Empty, fmtDate } from "@/components/ui";
import type { Actor, Cell } from "@/lib/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cells" };

interface CellRow extends Cell {
  total: number;
  nextDue: number | null;
}

/** Same aggregation as GET /api/cells, plus each cell's next due date. */
async function listCells(actor: Actor): Promise<CellRow[]> {
  const wide = actor.user.role === "principal" || actor.user.role === "chair";
  const res = await query<any>(`
    SELECT c.id, c.number, c.name, c.mandate,
      h.name AS head_name, h.id AS head_id,
      COALESCE(o.cnt, 0)::int AS open_count,
      COALESCE(t.cnt, 0)::int AS total_count,
      d.next_due
    FROM cells c
    LEFT JOIN memberships m ON m.cell_id = c.id AND m.role = 'head'
    LEFT JOIN users h ON h.id = m.user_id
    LEFT JOIN (
      SELECT cell_id, COUNT(*)::int AS cnt FROM circulars
      WHERE state <> 'done' GROUP BY cell_id
    ) o ON o.cell_id = c.id
    LEFT JOIN (
      SELECT cell_id, COUNT(*)::int AS cnt FROM circulars GROUP BY cell_id
    ) t ON t.cell_id = c.id
    LEFT JOIN (
      SELECT cell_id, MIN(due_at) AS next_due FROM circulars
      WHERE state <> 'done' AND due_at IS NOT NULL GROUP BY cell_id
    ) d ON d.cell_id = c.id
    ORDER BY c.number::int
  `);
  const rows: CellRow[] = res.rows.map((r: any) => ({
    id: r.id,
    number: Number(r.number),
    name: r.name,
    mandate: r.mandate ?? "",
    head: r.head_id
      ? { id: r.head_id, name: r.head_name }
      : null,
    openCirculars: Number(r.open_count ?? 0),
    total: Number(r.total_count ?? 0),
    nextDue: r.next_due == null ? null : Number(r.next_due),
  }));
  if (wide) return rows;
  // Heads and members only see cells they belong to.
  const mine = new Set(actor.memberships.map((m) => m.cellId));
  return rows.filter((c) => mine.has(c.id));
}

export default async function CellsPage() {
  const actor = await actorFromSession();
  if (!actor) redirect("/login");

  const cells = await listCells(actor);
  const allTotal = cells.reduce((n, c) => n + c.total, 0);
  const openTotal = cells.reduce((n, c) => n + c.openCirculars, 0);

  return (
    <>
      <Page
        eyebrow="The fourteen standing cells"
        title="Cells"
        sub={
          <>
            {openTotal} open circulars across {cells.length} cells ({allTotal} all-time). Open a
            cell to see its slice of the register.
          </>
        }
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(250px, 100%), 1fr))",
          gap: "var(--sp-16)",
        }}
      >
        {cells.map((c) => {
          const overdueish = c.nextDue != null && c.nextDue < Date.now();
          return (
            <article
              key={c.id}
              className="card"
              style={{ padding: "16px 18px", display: "grid", gap: 8, overflow: "hidden" }}
              data-testid="cell-card"
            >
              <div className="sect">
                <span
                  className="pill blue"
                  aria-hidden="true"
                  style={{ fontWeight: 800, fontSize: "var(--fs-md)" }}
                >
                  {c.number}
                </span>
                <Pill tone={c.openCirculars > 0 ? "amber" : "green"}>
                  {c.openCirculars} open
                </Pill>
              </div>
              <div>
                <h2 style={{ fontSize: "var(--fs-base)" }}>
                  <Link href={`/circulars?cell=${c.id}`} style={{ color: "inherit" }}>
                    {c.name}
                  </Link>
                </h2>
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", marginTop: 2 }}>
                  {c.head ? <>Head: {c.head.name}</> : <>No head assigned</>} · {c.total} all-time
                </p>
              </div>
              {c.nextDue != null ? (
                <p style={{ fontSize: "var(--fs-sm)", margin: 0 }}>
                  Next due{" "}
                  <b style={{ color: overdueish ? "var(--danger)" : "var(--text)" }}>
                    {fmtDate(c.nextDue)}
                  </b>
                </p>
              ) : (
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", margin: 0 }}>
                  Nothing dated in the queue.
                </p>
              )}
              {c.openCirculars === 0 ? (
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", margin: 0 }}>
                  Clear — check the register for anything new.
                </p>
              ) : (
                <Link href={`/circulars?cell=${c.id}`} className="btn sm" style={{ justifySelf: "start" }}>
                  View its circulars
                </Link>
              )}
            </article>
          );
        })}
      </div>
      {cells.length === 0 ? (
        <Card as="div">
          <div className="pad">
            <Empty
              title="You are not yet a member of any cell"
              hint="Ask the chairperson to add you to a cell to see its workload here."
            />
          </div>
        </Card>
      ) : null}
    </>
  );
}
