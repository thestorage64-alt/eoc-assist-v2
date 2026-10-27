import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { actorFromSession } from "../actor";
import { getReportSummary } from "@/lib/insight/reports";
import { SDG_NAMES } from "@/lib/contracts";
import { Page, Card, Pill, Empty, Icon, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

const DAY = 86_400_000;

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const PERIODS: { id: string; label: string; days: number }[] = [
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last quarter", days: 90 },
  { id: "180", label: "Last two quarters", days: 180 },
  { id: "365", label: "Last year", days: 365 },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await actorFromSession();
  if (!actor) redirect("/login");

  const sp = await searchParams;
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v || undefined;

  const now = Date.now();
  const periodParam = one(sp.period) ?? "30";
  const period = PERIODS.find((p) => p.id === periodParam) ?? PERIODS[0];

  // Explicit dates win, otherwise the meta period applies.
  const fromParam = one(sp.from);
  const toParam = one(sp.to);
  let from = now - period.days * DAY;
  let to = now;
  if (fromParam) {
    const p = Date.parse(fromParam);
    if (Number.isFinite(p)) from = p;
  }
  if (toParam) {
    const p = Date.parse(`${toParam}T23:59:59.999Z`);
    if (Number.isFinite(p)) to = p;
  }

  const r = await getReportSummary(actor, from, to);

  const periodNote =
    fromParam || toParam
      ? `${fmtDate(r.from)} – ${fmtDate(r.to)}`
      : `${period.label} · ${fmtDate(r.from)} – ${fmtDate(r.to)}`;

  const evidenceQuery = new URLSearchParams({ from: isoDay(r.from), to: isoDay(r.to) });

  const maxSdg = Math.max(1, ...r.sdgCoverage.map((s) => s.count));

  return (
    <>
      <Page
        eyebrow={periodNote}
        title="Reports"
        sub="What the Equal Opportunity Cell received, decided, completed and is still owed — grounded in the register."
      />

      {/* ------------------------------------------------ period selector --- */}
      <Card as="div">
        <form
          method="get"
          action="/reports"
          className="pad"
          aria-label="Choose reporting period"
          style={{
            display: "grid",
            gap: "var(--sp-12)",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
            alignItems: "end",
            gridAutoFlow: "row",
          }}
        >
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="r-period">Preset period</label>
            <select id="r-period" name="period" className="select" defaultValue={period.id}>
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="r-from">From</label>
            <input
              id="r-from"
              name="from"
              type="date"
              className="input"
              defaultValue={
                fromParam ? isoDay(from) : isoDay(now - period.days * DAY)
              }
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="r-to">To</label>
            <input id="r-to" name="to" type="date" className="input" defaultValue={isoDay(to)} />
          </div>
          <div style={{ display: "flex", gap: "var(--sp-12)" }}>
            <button type="submit" className="btn primary">
              Apply
            </button>
            <a
              className="btn"
              href={`/api/reports/evidence?${evidenceQuery.toString()}`}
              download
            >
              <Icon name="doc" size={15} /> Evidence pack
            </a>
          </div>
        </form>
      </Card>

      {/* ---------------------------------------------------------- totals --- */}
      <div className="grid4">
        {[
          { t: "Circulars received", n: r.received, d: "In the selected period" },
          { t: "Routed beyond intake", n: r.routed, d: "Reached a cell" },
          { t: "Completed", n: r.completed, d: `of ${r.received} received` },
          { t: "Meetings held", n: r.meetings, d: "Minutes-bearing sessions" },
        ].map((k, i) => (
          <div className="card kpi" key={i} data-testid={`report-${k.t.replace(/\s+/g, "-").toLowerCase()}`}>
            <div className="accent" />
            <div className="t">{k.t}</div>
            <div className="n big">{k.n}</div>
            <div className="d">{k.d}</div>
          </div>
        ))}
      </div>
      <div className="grid-2">
        <div className="card kpi">
          <div className="accent" />
          <div className="t">Actions open</div>
          <div className="n big">{r.actionsOpen}</div>
          <div className="d">Waiting on an owner</div>
        </div>
        <div className="card kpi">
          <div className="accent r" />
          <div className="t">Actions overdue</div>
          <div className="n big">{r.actionsOverdue}</div>
          <div className="d">{r.actionsOverdue > 0 ? "Chase these first" : "Nothing past its date"}</div>
        </div>
      </div>

      <div className="split">
        {/* --------------------------------------------------- per cell table --- */}
        <Card title="By cell" aside={<Pill tone="grey">{r.perCell.length} cells</Pill>}>
          <div className="pad">
            {r.received === 0 && r.perCell.every((c) => c.received === 0) ? (
              <Empty
                title="Nothing received in this period"
                hint="Widen the period above, or check the circular register for the newest arrivals."
              />
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Cell</th>
                      <th scope="col">Received</th>
                      <th scope="col">Completed</th>
                      <th scope="col">In flight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.perCell.map((c) => (
                      <tr key={c.cellId}>
                        <td>
                          <Link href={`/circulars?cell=${c.cellId}`} style={{ color: "inherit" }}>
                            {c.name}
                          </Link>
                        </td>
                        <td className="mono">{c.received}</td>
                        <td className="mono">{c.completed}</td>
                        <td className="mono">{c.received - c.completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* --------------------------------------------------- sdg coverage --- */}
        <Card title="SDG coverage" aside={<Pill tone="blue">{r.sdgCoverage.length} goals engaged</Pill>}>
          <div className="pad">
            {r.sdgCoverage.length === 0 ? (
              <Empty
                title="No final classifications in this period"
                hint="SDG coverage counts confirmed classifications. Ask cells to confirm pending suggestions."
              />
            ) : (
              <div role="list" aria-label="SDG coverage">
                {r.sdgCoverage
                  .slice()
                  .sort((a, b) => b.count - a.count)
                  .map((s) => (
                    <div className="load-row" role="listitem" key={s.sdg}>
                      <div className="nm" title={SDG_NAMES[s.sdg] ?? `SDG ${s.sdg}`}>
                        {SDG_NAMES[s.sdg] ?? `SDG ${s.sdg}`}
                      </div>
                      <div className="bar" role="img" aria-label={`${SDG_NAMES[s.sdg] ?? s.sdg}: ${s.count}`}>
                        <i style={{ width: `${Math.max(8, Math.round((s.count / maxSdg) * 100))}%` }} />
                      </div>
                      <div className="v">{s.count}</div>
                    </div>
                  ))}
              </div>
            )}
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", marginTop: "var(--sp-12)" }}>
              Counts are primary SDGs from confirmed classifications.
            </p>
          </div>
        </Card>
      </div>

      <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
        The evidence pack is a markdown bundle of these totals plus a timestamped audit
        extract — the same package shown in rendered form above.
      </p>
    </>
  );
}
