import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { actorFromSession } from "../actor";
import { listCirculars } from "@/lib/circulars/repo";
import { isState, CELL_SPEC, STATES, STATE_LABEL, type CircularState } from "@/lib/contracts";
import { canCreateCircular } from "@/lib/core/permissions";
import { query } from "@/lib/core/db";
import { Page, Card, Pill, Empty, Button, fmtDue, fmtDate, StatePill } from "@/components/ui";
import NewCircular from "@/components/NewCircular";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Circulars" };

const CELL_NAME = new Map(CELL_SPEC.map((c) => [c.id, `${c.number}. ${c.name}`]));

export default async function CircularsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await actorFromSession();
  if (!actor) redirect("/login");

  const sp = await searchParams;
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v || undefined;

  const stateParam = one(sp.state);
  const state: CircularState | undefined = isState(stateParam) ? stateParam : undefined;
  const cell = one(sp.cell);
  const q = (one(sp.q) ?? "").trim();

  const rows = await listCirculars(actor, { state, cell: cell || undefined, q: q || undefined });

  // Resolve owner display names in one query.
  const ownerIds = [...new Set(rows.map((r) => r.assignedTo).filter((v): v is string => Boolean(v)))];
  const owners = new Map<string, string>();
  if (ownerIds.length > 0) {
    const res = await query<{ id: string; name: string }>(
      "SELECT id, name FROM users WHERE id = ANY($1::text[])",
      [ownerIds]
    );
    for (const r of res.rows) owners.set(r.id, r.name);
  }

  const filtered = Boolean(state || cell || q);
  const canCreate = canCreateCircular(actor);

  return (
    <>
      <Page
        eyebrow="Circular inbox"
        title="Circulars"
        sub={
          q
            ? `Search results for “${q}”.`
            : filtered
              ? "Filtered view of the circular register."
              : "Everything that has reached the Equal Opportunity Cell, newest first."
        }
        actions={
          canCreate ? (
            <NewCircular cells={CELL_SPEC.map((c) => ({ id: c.id, number: c.number, name: c.name }))} />
          ) : (
            <Pill tone="blue">Read-only view</Pill>
          )
        }
      />

      <form
        method="get"
        action="/circulars"
        role="search"
        aria-label="Filter circulars"
        className="card"
        style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: "var(--sp-12)", padding: "var(--sp-16)" }}
      >
        <div
          style={{
            display: "grid",
            gap: "var(--sp-12)",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
          }}
        >
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="f-q">Search title or text</label>
            <input
              id="f-q"
              name="q"
              className="input"
              type="search"
              defaultValue={q}
              placeholder="Search circulars…"
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="f-state">State</label>
            <select id="f-state" name="state" className="select" defaultValue={state ?? ""}>
              <option value="">All states</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="f-cell">Cell</label>
            <select id="f-cell" name="cell" className="select" defaultValue={cell ?? ""}>
              <option value="">All cells</option>
              {CELL_SPEC.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number}. {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-12)", flexWrap: "wrap" }}>
          <button type="submit" className="btn">
            Apply filters
          </button>
          {filtered ? (
            <a className="btn ghost" href="/circulars">
              Clear filters
            </a>
          ) : null}
        </div>
      </form>

      <Card
        title={filtered ? "Matching circulars" : "All circulars"}
        aside={<Pill tone="grey">{rows.length} shown</Pill>}
      >
        <div className="pad">
          {rows.length === 0 ? (
            <Empty
              title={filtered ? "No circulars match these filters" : "No circulars yet"}
              hint={
                filtered
                  ? "Try a shorter search term, or clear the filters to see the whole register."
                  : "When the Principal's office forwards a circular it lands here for routing."
              }
              action={
                filtered ? (
                  <Button href="/circulars" size="sm">
                    Clear filters
                  </Button>
                ) : canCreate ? undefined : (
                  <Button href="/command" size="sm">
                    Back to the command centre
                  </Button>
                )
              }
            />
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Ref</th>
                    <th scope="col">Title</th>
                    <th scope="col">Cell</th>
                    <th scope="col">State</th>
                    <th scope="col">Due</th>
                    <th scope="col">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const due = fmtDue(c.dueAt);
                    return (
                      <tr key={c.id}>
                        <td className="mono">
                          <Link href={`/circulars/${c.id}`}>{c.ref}</Link>
                        </td>
                        <td style={{ minWidth: 220 }}>
                          <b>
                            <Link href={`/circulars/${c.id}`} style={{ color: "inherit" }}>
                              {c.title}
                            </Link>
                          </b>
                          {c.confidential ? (
                            <>
                              {" "}
                              <Pill tone="red">Confidential</Pill>
                            </>
                          ) : null}
                          <div style={{ color: "var(--muted)", marginTop: 2 }}>
                            Received {fmtDate(c.receivedAt)}
                          </div>
                        </td>
                        <td>{c.cellId ? (CELL_NAME.get(c.cellId) ?? "—") : <em>Unrouted</em>}</td>
                        <td>
                          <StatePill state={c.state} />
                        </td>
                        <td>
                          <Pill tone={due.tone}>{c.dueAt == null ? "—" : due.label}</Pill>
                        </td>
                        <td>{c.assignedTo ? (owners.get(c.assignedTo) ?? "Unknown") : <em>Unassigned</em>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
