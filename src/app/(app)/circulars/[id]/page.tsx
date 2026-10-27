import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { actorFromSession } from "../../actor";
import {
  getCircular,
  getClassification,
  getMeetings,
  getActions,
  getDocuments,
  hasApprovedReport,
} from "@/lib/circulars/repo";
import { query } from "@/lib/core/db";
import {
  canReadCircular,
  canConfirmClassification,
  canAdvance,
  canSignMinutes,
  isPrincipal,
  isChair,
  cellRoleOf,
} from "@/lib/core/permissions";
import { nextState, STATE_LABEL, CELL_SPEC, type User } from "@/lib/contracts";
import { Page, Card, Pill, Icon, fmtDate, fmtDue } from "@/components/ui";
import ClassificationPanel from "@/components/ClassificationPanel";
import MeetingPanel, { type MeetingPerson } from "@/components/MeetingPanel";
import StageBar from "@/components/StageBar";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Circular" };

const CELL_NAME = new Map(CELL_SPEC.map((c) => [c.id, `${c.number}. ${c.name}`]));

export default async function CircularDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await actorFromSession();
  if (!actor) redirect("/login");

  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    notFound();
  }

  const [classification, meetings, actions, documents] = await Promise.all([
    getClassification(id),
    getMeetings(id),
    getActions(id),
    getDocuments(id),
  ]);

  // One lookup for every display name on the page: decision-maker, signing
  // chairperson, action owners, assignments, attendees.
  const usersRes = await query<User>("SELECT id, name, email FROM users");
  const nameOf = new Map<string, string>();
  const people: MeetingPerson[] = [];
  for (const u of usersRes.rows) {
    nameOf.set(u.id, u.name);
    people.push({ id: u.id, name: u.name });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));

  const cellName = circular.cellId ? (CELL_NAME.get(circular.cellId) ?? circular.cellId) : null;
  const due = fmtDue(circular.dueAt);
  const next = nextState(circular.state);

  // --- permissions, mirror of the server-side enforcement ---
  const principal = isPrincipal(actor);
  const chair = isChair(actor);
  const head = cellRoleOf(actor, circular.cellId) === "head";
  // Authorise against the circular's own cell, not the suggested one: a head
  // must not be able to confirm work that belongs to another cell.
  const canConfirm =
    circular.cellId === null ? chair : canConfirmClassification(actor, circular.cellId);
  const canAdvanceStage = canAdvance(actor, { cellId: circular.cellId });
  const canMeetings = !principal && (chair || head);
  const canMinutes = canSignMinutes(actor, circular.cellId);
  const canAddAction = !principal && (chair || head || circular.assignedTo === actor.user.id);

  // Stage gates: intake→route needs a final classification; report→done needs
  // an approved report document.
  let gate: string | null = null;
  if (next) {
    if (circular.state === "intake" && !classification.final) {
      gate = "Confirm a classification before routing";
    } else if (circular.state === "report" && !(await hasApprovedReport(id))) {
      gate = "An approved report document is required";
    }
  }

  const decidedByName = classification.decidedBy ? (nameOf.get(classification.decidedBy) ?? null) : null;
  const assignedName = circular.assignedTo ? (nameOf.get(circular.assignedTo) ?? null) : null;

  const openActions = actions.filter((a) => a.status === "open");

  return (
    <>
      <Page
        eyebrow={`${circular.ref}${circular.source ? ` · from ${circular.source}` : ""}`}
        title={circular.title}
        sub={
          <>
            Received {fmtDate(circular.receivedAt)}
            {cellName ? <> · {cellName}</> : <> · not routed to a cell yet</>}
            {assignedName ? <> · owner {assignedName}</> : null}
            {circular.confidential ? <> · confidential</> : null}
          </>
        }
        actions={
          <>
            {circular.dueAt != null ? <Pill tone={due.tone}>{due.label}</Pill> : null}
            <a className="btn sm" href={`/api/circulars/${id}/export?format=pdf`} download>
              <Icon name="doc" size={14} /> PDF
            </a>
            <a className="btn sm" href={`/api/circulars/${id}/export?format=docx`} download>
              <Icon name="doc" size={14} /> DOCX
            </a>
            <a className="btn sm" href={`/api/circulars/${id}/export?format=md`} download>
              <Icon name="doc" size={14} /> MD
            </a>
          </>
        }
      />

      <Card as="div" testid="stage-timeline">
        <StageBar circularId={id} state={circular.state} canAdvance={canAdvanceStage} gate={gate} />
      </Card>

      <div className="split">
        {/* ------------------------------------------------- main column --- */}
        <div style={{ display: "grid", gap: "var(--sp-24)", minWidth: 0 }}>
          <Card title="Source text">
            <div className="pad">
              <p
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "var(--fs-base)",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {circular.body.trim().length > 0 ? circular.body : "The circular text was not captured when it was registered."}
              </p>
            </div>
          </Card>

          <MeetingPanel
            circularId={id}
            meetings={meetings}
            actions={actions}
            people={people}
            actorId={actor.user.id}
            can={{
              createMeeting: canMeetings,
              generateMinutes: canMinutes,
              sign: canMinutes,
              addAction: canAddAction,
              isChair: chair,
              isHead: head,
            }}
          />
        </div>

        {/* ----------------------------------------------------- side rail --- */}
        <div style={{ display: "grid", gap: "var(--sp-24)", minWidth: 0, alignContent: "start" }}>
          <Card
            title="Classification"
            aside={
              classification.final ? (
                <Pill tone={classification.verdict === "confirmed" ? "green" : "amber"}>
                  {classification.verdict === "confirmed" ? "Confirmed" : "Corrected"}
                </Pill>
              ) : (
                <Pill tone="amber">Undecided</Pill>
              )
            }
          >
            <ClassificationPanel
              circularId={id}
              suggestion={classification.suggestion}
              final={classification.final}
              verdict={classification.verdict}
              decidedByName={decidedByName}
              decidedAt={classification.decidedAt}
              canSuggest={!principal}
              canConfirm={canConfirm}
            />
          </Card>

          <Card title="Documents" aside={<Pill tone="grey">{documents.length}</Pill>}>
            <div className="pad">
              {documents.length === 0 ? (
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
                  No documents filed against this circular yet. Reports and certificates appear
                  here once the cell drafts them.
                </p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
                  {documents.map((d) => (
                    <li key={d.id} style={{ fontSize: "var(--fs-sm)" }}>
                      <b>{d.kind}</b> · v{d.version} · filed {fmtDate(d.createdAt)}
                      {d.approvedAt ? (
                        <>
                          {" "}
                          · approved{" "}
                          <Pill tone="green">
                            {d.approvedBy ? `by ${nameOf.get(d.approvedBy) ?? "reviewer"}` : "approved"}
                          </Pill>
                        </>
                      ) : (
                        <> · awaiting approval</>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card title="In numbers">
            <div className="pad">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "var(--sp-12)",
                  textAlign: "center",
                }}
              >
                <div>
                  <div className="kpi n" style={{ fontSize: "var(--fs-md)", fontWeight: 700 }}>
                    {meetings.length}
                  </div>
                  <div style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>Meetings</div>
                </div>
                <div>
                  <div className="kpi n" style={{ fontSize: "var(--fs-md)", fontWeight: 700 }}>
                    {openActions.length}
                  </div>
                  <div style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>Open actions</div>
                </div>
                <div>
                  <div
                    className="kpi n"
                    style={{
                      fontSize: "var(--fs-md)",
                      fontWeight: 700,
                      color: actions.length - openActions.length > 0 ? "var(--ok)" : "var(--muted)",
                    }}
                  >
                    {actions.length - openActions.length}
                  </div>
                  <div style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>Closed actions</div>
                </div>
              </div>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", margin: "var(--sp-12) 0 0" }}>
                The export buttons above file a complete, timestamped record of this circular —
                text, classification, meetings, minutes and actions — as {STATE_LABEL[circular.state]} evidence.
              </p>
            </div>
          </Card>

          <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
            Back to <Link href="/circulars">the circular register</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
