import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { actorFromSession } from "../actor";
import { listCirculars } from "@/lib/circulars/repo";
import { query } from "@/lib/core/db";
import { STATES, STATE_LABEL, CELL_SPEC, type User } from "@/lib/contracts";
import { Page, Card, Empty, StatePill, fmtDue, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workflow" };

const CELL_NAME = new Map(CELL_SPEC.map((c) => [c.id, `${c.number}. ${c.name}`]));

export default async function WorkflowPage() {
  const actor = await actorFromSession();
  if (!actor) redirect("/login");

  const rows = await listCirculars(actor);
  const ownerIds = [...new Set(rows.map((r) => r.assignedTo).filter((v): v is string => Boolean(v)))];
  const owners = new Map<string, string>();
  if (ownerIds.length > 0) {
    const res = await query<User>("SELECT id, name FROM users WHERE id = ANY($1::text[])", [ownerIds]);
    for (const r of res.rows) owners.set(r.id, r.name);
  }

  const columns = STATES.map((s) => ({
    state: s,
    label: STATE_LABEL[s],
    items: rows.filter((r) => r.state === s),
  }));
  const total = rows.length;

  return (
    <>
      <Page
        eyebrow="The nine-stage lifecycle"
        title="Workflow"
        sub={
          <>
            Every circular, all nine columns, left to right. {total} in view —{" "}
            <b style={{ color: "var(--text)" }}>
              scroll the board horizontally on narrower screens.
            </b>
          </>
        }
      />
      <Card as="div" testid="workflow-board">
        <div className="pad">
          <div style={{ overflowX: "auto", paddingBottom: "var(--sp-8)" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(9, minmax(214px, 1fr))`,
                gap: "var(--sp-12)",
                alignItems: "start",
                minWidth: "max(100%, 1866px)",
              }}
            >
              {columns.map((col) => {
                const overdue = col.items.filter(
                  (c) => c.dueAt != null && c.dueAt < Date.now() && c.state !== "done"
                ).length;
                return (
                  <section
                    key={col.state}
                    className="inset"
                    style={{ padding: "var(--sp-12)", display: "flex", flexDirection: "column", gap: "var(--sp-12)", minHeight: "200px" }}
                    aria-label={`${col.label} column, ${col.items.length} circulars`}
                  >
                    <div className="sect">
                      <h2 style={{ fontSize: "var(--fs-sm)" }}>{col.label}</h2>
                      <Pill tone={col.items.length === 0 ? "grey" : overdue > 0 ? "red" : "blue"}>
                        {col.items.length}
                      </Pill>
                    </div>
                    {col.items.length === 0 ? (
                      <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
                        Nothing here right now.
                      </p>
                    ) : (
                      col.items.map((c) => {
                        const due = fmtDue(c.dueAt);
                        return (
                          <article key={c.id} className="inset" style={{ padding: "10px 12px", background: "var(--panel)" }}>
                            <b style={{ display: "block", fontSize: "var(--fs-sm)" }}>
                              <Link href={`/circulars/${c.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                                {c.title}
                              </Link>
                            </b>
                            <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", marginTop: 2 }}>
                              {c.cellId ? CELL_NAME.get(c.cellId) ?? c.cellId : "Unrouted"}
                              {c.assignedTo ? <> · {owners.get(c.assignedTo) ?? "Unknown"}</> : " · Unassigned"}
                            </p>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                              <Pill tone={due.tone}>{c.dueAt == null ? "No due date" : due.label}</Pill>
                              <StatePill state={c.state} />
                            </div>
                          </article>
                        );
                      })
                    )}
                  </section>
                );
              })}
            </div>
          </div>
          {total === 0 ? (
            <Empty
              title="The board is empty"
              hint="Nothing has been registered yet. Add a circular from the inbox to see the lifecycle fill up."
            />
          ) : null}
        </div>
      </Card>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
        A circular moves right one column at a time from its detail page. Open a card to
        route, convene or close it.
      </p>
    </>
  );
}
