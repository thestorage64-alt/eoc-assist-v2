import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { actorFromSession } from "../actor";
import { getDashboard } from "@/lib/insight/dashboard";
import { Page, Card, Pill, Empty, Icon, fmtDue, greeting, StatePill, Button } from "@/components/ui";
import { STATES } from "@/lib/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Command centre" };

const ROLE_SUB: Record<string, string> = {
  principal: "Institution-wide view · read-only assurance",
  chair: "Chairperson's desk · every cell and stage",
  head: "Your cells · queues and deadlines",
  member: "Your work · actions and deadlines",
};

export default async function CommandPage() {
  const actor = await actorFromSession();
  if (!actor) redirect("/login");

  const dash = await getDashboard(actor);
  const now = Date.now();
  const attention = dash.needsAttention;
  const { byState, open, overdue } = dash.counts;
  const firstName = actor.user.name.trim().replace(/\.+$/, "");

  const deadlineItems = attention.filter((n) => n.dueAt != null).slice(0, 5);
  const loadingCells = [...dash.cells]
    .filter((c) => c.open > 0)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
    .slice(0, 6);
  const maxOpen = Math.max(1, ...dash.cells.map((c) => c.open));

  return (
    <>
      <Page
        eyebrow={`Today · ${new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(now)}`}
        title={`${greeting()}, ${firstName}`}
        sub={
          <>
            {ROLE_SUB[actor.user.role] ?? "Your work"} ·{" "}
            <b style={{ color: "var(--text)" }}>
              {open === 0 ? "nothing open right now" : `${open} circular${open === 1 ? "" : "s"} in flight`}
            </b>
            {overdue > 0 ? (
              <>
                {" "}
                with{" "}
                <b style={{ color: "var(--danger)" }}>{overdue} overdue</b>
              </>
            ) : null}
            .
          </>
        }
        actions={
          actor.user.role === "principal" ? (
            <Pill tone="blue">Read-only view</Pill>
          ) : (
            <Button href="/circulars" variant="primary">
              <Icon name="inbox" size={15} />
              Circular inbox
            </Button>
          )
        }
      />

      {/* --- four KPIs --- */}
      <div className="grid4">
        <div className="card kpi" data-testid="kpi-open">
          <div className="accent" />
          <div className="t">Open circulars</div>
          <div className="n big">{open}</div>
          <div className="d">{byState["intake"] ?? 0} still in intake</div>
        </div>
        <div className="card kpi" data-testid="kpi-overdue">
          <div className="accent r" />
          <div className="t">Overdue circulars</div>
          <div className="n big">{overdue}</div>
          <div className="d">{overdue > 0 ? "Needs chasing today" : "Nothing past its date"}</div>
        </div>
        <div className="card kpi" data-testid="kpi-attention">
          <div className="accent m" />
          <div className="t">Needs your attention</div>
          <div className="n big">{attention.length}</div>
          <div className="d">{attention.length > 0 ? "Below — start at the top" : "Clear right now"}</div>
        </div>
        <div className="card kpi g" data-testid="kpi-done">
          <div className="accent g" />
          <div className="t">Completed</div>
          <div className="n big">{byState["done"] ?? 0}</div>
          <div className="d">Across the whole lifecycle</div>
        </div>
      </div>

      <div className="split">
        {/* --- needs your attention --- */}
        <Card
          title="Needs your attention"
          aside={<Pill tone={attention.length > 0 ? "amber" : "green"}>{attention.length}</Pill>}
        >
          <div className="pad">
            {attention.length === 0 ? (
              <Empty
                title="Nothing waiting on you"
                hint="New circulars still need an owner. Open the circular inbox and route whatever is sitting in intake."
                action={
                  <Button href="/circulars" size="sm">
                    Open circular inbox
                  </Button>
                }
              />
            ) : (
              <div className="list">
                {attention.map((n) => (
                  <div className="item" key={n.circularId}>
                    <span
                      className="ico"
                      aria-hidden="true"
                      style={{ color: "var(--warn)", background: "var(--warn-soft)" }}
                    >
                      <Icon name="alert" size={15} />
                    </span>
                    <div className="grow">
                      <b>
                        <Link href={`/circulars/${n.circularId}`} style={{ color: "inherit", textDecoration: "none" }}>
                          {n.title}
                        </Link>
                      </b>
                      <p>{n.reason}</p>
                    </div>
                    <div className="act">
                      {n.dueAt != null ? (
                        (() => {
                          const d = fmtDue(n.dueAt);
                          return <Pill tone={d.tone}>{d.label}</Pill>;
                        })()
                      ) : (
                        <Pill tone="grey">No due date</Pill>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <div className="list" style={{ gap: "var(--sp-16)", display: "flex", flexDirection: "column" }}>
          {/* --- deadline radar --- */}
          <Card title="Deadline radar" aside={<Pill tone="grey">{deadlineItems.length} dated</Pill>}>
            <div className="pad">
              {deadlineItems.length === 0 ? (
                <Empty
                  title="No dated deadlines in sight"
                  hint="Circulars move faster when they carry a due date. Set one on the next circular you route."
                />
              ) : (
                <div className="list">
                  {deadlineItems.map((n) => {
                    const d = fmtDue(n.dueAt as number);
                    return (
                      <div className="item" key={`radar-${n.circularId}`}>
                        <div className="act">
                          <Pill tone={d.tone}>{d.label}</Pill>
                        </div>
                        <div className="grow">
                          <b style={{ fontSize: "var(--fs-sm)" }}>
                            <Link
                              href={`/circulars/${n.circularId}`}
                              style={{ color: "inherit", textDecoration: "none" }}
                            >
                              {n.title}
                            </Link>
                          </b>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p style={{ color: "var(--muted)", marginTop: "var(--sp-8)" }}>
                Deadlines come from circulars and their open actions.
              </p>
            </div>
          </Card>

          {/* --- cell load --- */}
          <Card title="Cell load" aside={<Button href="/circulars" size="sm" variant="ghost">All cells</Button>}>
            <div className="pad">
              {loadingCells.length === 0 ? (
                <Empty
                  title="No open work in your cells"
                  hint={
                    actor.user.role === "principal"
                      ? "All 14 cells are clear. New circulars will appear here as soon as they are routed."
                      : "Your cells are clear. Check the circular inbox for anything new."
                  }
                />
              ) : (
                <div role="list" aria-label="Cell workload">
                  {loadingCells.map((c) => {
                    const pct = Math.round((c.open / maxOpen) * 100);
                    const barCls = c.overdue > 0 ? "bar bad" : c.open / maxOpen > 0.6 ? "bar warn" : "bar";
                    return (
                      <div className="load-row" role="listitem" key={c.cellId}>
                        <div className="nm">{c.name}</div>
                        <div
                          className={barCls}
                          role="img"
                          aria-label={`${c.name}: ${c.open} open, ${c.overdue} overdue`}
                        >
                          <i style={{ width: `${Math.max(6, pct)}%` }} />
                        </div>
                        <div className="v">{c.open}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* --- stage overview --- */}
      <Card title="Where everything stands" as="section">
        <div className="pad">
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {STATES.map((s) => (
                    <th scope="col" key={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {STATES.map((s) => {
                    const n = byState[s] ?? 0;
                    return (
                      <td key={s}>
                        <StatePill state={s} />
                        <b className="mono" style={{ marginLeft: 6 }}>
                          {n}
                        </b>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {dash.counts.byState["intake"] > 0 ? (
            <div className="inset" style={{ marginTop: "var(--sp-12)" }}>
              <p>
                <b>{dash.counts.byState["intake"]} circulars are in intake</b> — the next
                action is to route each one to a cell and confirm the classification.
              </p>
            </div>
          ) : null}
        </div>
      </Card>
    </>
  );
}
