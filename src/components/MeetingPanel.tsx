"use client";

/**
 * Meetings, minutes and actions for one circular.
 *
 * Create meeting → generate minutes (needs ≥40 chars of notes) → sign →
 * the proposed minutes actions become tracked action items with owners and
 * due dates. Also hosts the action list with add + close/reopen, gated by
 * the server-computed permission booleans below.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionItem, Meeting } from "@/lib/contracts";
import { ApiError, humanError, api } from "@/lib/client/api";
import { Icon, Pill, Empty, fmtDate, fmtDue } from "./ui";

export interface MeetingPerson {
  id: string;
  name: string;
}

export interface MeetingPanelProps {
  circularId: string;
  meetings: Meeting[];
  actions: ActionItem[];
  /** Active users for attendee / owner pickers. */
  people: MeetingPerson[];
  actorId: string;
  can: {
    /** chair or head of the circular's cell. */
    createMeeting: boolean;
    /** canSignMinutes server-side. */
    generateMinutes: boolean;
    /** same permission as generateMinutes — kept separate for copy clarity. */
    sign: boolean;
    /** chair, head of cell, or the assigned owner. */
    addAction: boolean;
    /** canCloseAction is per-row; this plus the row owner decides (see below). */
    isChair: boolean;
    /** head of the circular's cell. */
    isHead: boolean;
  };
}

function MeetingCard({
  m,
  people,
  can,
}: {
  m: Meeting;
  people: MeetingPerson[];
  can: MeetingPanelProps["can"];
}) {
  const name = new Map(people.map((p) => [p.id, p.name]));
  const tone = m.status === "signed" ? "green" : m.status === "held" ? "blue" : "amber";
  // The server sets `held` whenever notes exist, not when minutes do. Labelling
  // that "Minutes drafted" claimed work nobody had done.
  const label =
    m.status === "signed"
      ? "Signed"
      : m.minutesMd
        ? "Minutes drafted"
        : m.notes
          ? "Notes recorded"
          : "Scheduled";
  return (
    <article className="inset" style={{ display: "grid", gap: "var(--sp-8)" }} data-testid="meeting">
      <div className="sect">
        <b style={{ fontSize: "var(--fs-sm)" }}>Meeting · {fmtDate(m.heldAt)}</b>
        <Pill tone={tone}>{label}</Pill>
      </div>
      {m.attendees.length > 0 ? (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>
          Attendees: {m.attendees.map((id) => name.get(id) ?? id).join(", ")}
        </p>
      ) : null}
      {m.notes ? (
        <p style={{ fontSize: "var(--fs-sm)", whiteSpace: "pre-wrap" }}>{m.notes}</p>
      ) : null}
      <MinutesArea meeting={m} can={can} />
      {m.status === "signed" && m.signedAt != null ? (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--ok)", fontWeight: 600 }}>
          <Icon name="shield" size={14} /> Signed minutes — actions became trackable items.
        </p>
      ) : null}
    </article>
  );
}

function MinutesArea({
  meeting,
  can,
}: {
  meeting: Meeting;
  can: MeetingPanelProps["can"];
}) {
  const router = useRouter();
  const m = meeting;
  const [busy, setBusy] = useState<"minutes" | "sign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(m.notes ?? "");
  const [signedOut, setSignedOut] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const tooShort = notes.trim().length < 40;

  /**
   * Upload a recording; the provider transcribes it into the notes box. The
   * transcript is deliberately editable — it is a draft of what was said, not
   * minutes, and a person corrects it before anything is generated.
   */
  async function onAudio(file: File | null) {
    if (!file) return;
    setAudioBusy(true);
    setAudioError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAudioError(data?.error ?? "Couldn't transcribe that recording.");
        return;
      }
      setNotes((prev) => (prev.trim() ? prev.trim() + "\n\n" + data.text : data.text));
    } catch {
      setAudioError("Network problem while uploading — try again.");
    } finally {
      setAudioBusy(false);
    }
  }

  async function generate(manual = false) {
    setBusy("minutes");
    setError(null);
    try {
      await api.generateMinutes(m.id, notes, manual);
      router.refresh();
    } catch (e) {
      setError(humanError(e, "Couldn't draft minutes — try again, or record them by hand."));
    } finally {
      setBusy(null);
    }
  }

  async function sign() {
    setBusy("sign");
    setError(null);
    try {
      await api.signMinutes(m.id);
      setSignedOut(true);
      router.refresh();
    } catch (e) {
      setError(humanError(e, "Couldn't sign the minutes — try again."));
    } finally {
      setBusy(null);
    }
  }

  if (signedOut) {
    return (
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--ok)", fontWeight: 600 }} role="status">
        Minutes signed — the proposed actions now appear in the action list below.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--sp-8)" }}>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}

      {m.minutesMd ? (
        <details open={m.status !== "signed"}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "var(--fs-sm)" }}>
            Minutes (draft — signed off at signing)
          </summary>
          <pre
            style={{
              fontSize: "var(--fs-sm)",
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              background: "var(--panel-soft)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-control)",
              padding: "var(--sp-12)",
              margin: "var(--sp-8) 0 0",
            }}
          >
            {m.minutesMd}
          </pre>
        </details>
      ) : null}

      {m.decisions.length > 0 ? (
        <div>
          <b style={{ fontSize: "var(--fs-sm)" }}>Decisions</b>
          <ul style={{ margin: "var(--sp-4) 0 0", paddingLeft: 20 }}>
            {m.decisions.map((d, i) => (
              <li key={i} style={{ fontSize: "var(--fs-sm)" }}>
                {d}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {m.proposedActions.length > 0 ? (
        <div>
          <b style={{ fontSize: "var(--fs-sm)" }}>Proposed actions — not yet trackable</b>
          <ul style={{ margin: "var(--sp-4) 0 0", paddingLeft: 20 }}>
            {m.proposedActions.map((pa, i) => (
              <li key={i} style={{ fontSize: "var(--fs-sm)" }}>
                {pa.title}
                {pa.ownerName ? <> — {pa.ownerName}</> : null}
                {pa.dueDate ? <> · due {pa.dueDate}</> : null}
              </li>
            ))}
          </ul>
          {m.status !== "signed" ? (
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", marginTop: 2 }}>
              Signing turns these into tracked action items.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Controls only exist for someone the server will actually allow. Without
          this gate, the principal and ordinary members saw "Generate minutes"
          and received a raw 403 when they pressed it. */}
      {m.status !== "signed" && can.generateMinutes ? (
        <div style={{ display: "grid", gap: "var(--sp-8)" }}>
          <label
            htmlFor={`m-notes-${m.id}`}
            style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}
          >
            Meeting notes — at least 40 characters before minutes can be generated
          </label>
          <textarea
            id={`m-notes-${m.id}`}
            className="textarea"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was discussed, what was decided, who will do what by when…"
          />
          <div className="field" style={{ marginTop: "var(--sp-8)" }}>
            <label htmlFor={`m-audio-${m.id}`}>Or attach the recording</label>
            <input
              id={`m-audio-${m.id}`}
              className="input"
              type="file"
              accept=".mp3,.m4a,.wav,.webm,.ogg,.flac,.mp4"
              disabled={audioBusy || busy !== null}
              onChange={(e) => void onAudio(e.target.files?.[0] ?? null)}
            />
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", margin: "var(--sp-8) 0 0" }}>
              The recording is transcribed into the notes above. Read it, correct it, then draft the minutes.
            </p>
            {audioBusy ? (
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", margin: "var(--sp-8) 0 0" }} role="status">
                Transcribing the recording…
              </p>
            ) : null}
            {audioError ? (
              <span className="form-error" role="alert" style={{ marginTop: "var(--sp-8)" }}>
                {audioError}
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "var(--sp-12)", flexWrap: "wrap" }}>
            {tooShort ? (
              <span style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", alignSelf: "center" }}>
                {40 - notes.trim().length} more characters needed
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "var(--sp-12)", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => void generate()}
              disabled={busy !== null || tooShort}
              title={tooShort ? "Add at least 40 characters of notes first" : undefined}
            >
              <Icon name="spark" size={14} />
              {busy === "minutes" ? "Drafting minutes…" : "Generate minutes"}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => void generate(true)}
              disabled={busy !== null || tooShort}
              title="Record the minutes without the AI — useful when the provider is unavailable"
            >
              Record by hand
            </button>
            {m.minutesMd ? (
              <button
                type="button"
                className="btn sm primary"
                onClick={() => void sign()}
                disabled={busy !== null}
              >
                <Icon name="shield" size={14} />
                {busy === "sign" ? "Signing…" : "Sign minutes"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionRow({
  a,
  people,
  actorId,
  closeable,
}: {
  a: ActionItem;
  people: MeetingPerson[];
  actorId: string;
  closeable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = people.find((p) => p.id === a.ownerId);
  const due = fmtDue(a.dueAt);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api.updateAction(a.id, a.status === "open" ? "done" : "open");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't update the action — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="item" data-testid="action" role="listitem">
      <span
        className="ico"
        aria-hidden="true"
        style={{ background: a.status === "done" ? "var(--ok-soft)" : "var(--accent-soft)", color: a.status === "done" ? "var(--ok)" : "var(--accent)" }}
      >
        <Icon name={a.status === "done" ? "check" : "clock"} size={15} />
      </span>
      <div className="grow">
        <b>{a.title}</b>
        <p>
          {owner ? <>Owner: {owner.name}</> : a.ownerId ? <>Owner: unknown user</> : "No owner"} ·{" "}
          {a.meetingId ? "from meeting minutes" : "added directly"}
        </p>
        {error ? <p style={{ color: "var(--danger)", fontWeight: 600 }}>{error}</p> : null}
      </div>
      <div className="act" style={{ display: "flex", gap: "var(--sp-12)", alignItems: "center" }}>
        {a.status === "open" && a.dueAt != null ? <Pill tone={due.tone}>{due.label}</Pill> : <Pill tone={due.tone}>{a.status}</Pill>}
        {closeable ? (
          <button type="button" className="btn sm" onClick={() => void toggle()} disabled={busy}>
            {busy ? "Saving…" : a.status === "open" ? "Mark done" : "Reopen"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function MeetingPanel({
  circularId,
  meetings,
  actions,
  people,
  actorId,
  can,
}: MeetingPanelProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [heldAt, setHeldAt] = useState("");
  const [attendance, setAttendance] = useState<string[]>([]);
  const [meetingNotes, setMeetingNotes] = useState("");

  const [addingAction, setAddingAction] = useState(false);
  const [actionTitle, setActionTitle] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [actionDue, setActionDue] = useState("");

  const open = actions.filter((a) => a.status === "open");
  const now = new Date();
  const defaultSlot = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T10:30`;

  async function createMeeting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const ms = heldAt ? new Date(heldAt).getTime() : Date.now();
      await api.createMeeting(circularId, {
        heldAt: Number.isFinite(ms) ? ms : undefined,
        attendees: attendance,
        notes: meetingNotes.trim(),
      });
      setCreating(false);
      setHeldAt("");
      setAttendance([]);
      setMeetingNotes("");
      setNotice("Meeting added to this circular's record.");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the meeting — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createActionItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const ms = actionDue ? new Date(`${actionDue}T12:00:00`).getTime() : null;
      await api.addAction(circularId, {
        title: actionTitle.trim(),
        ownerId: actionOwner || null,
        dueAt: ms != null && Number.isFinite(ms) ? ms : null,
      });
      setAddingAction(false);
      setActionTitle("");
      setActionOwner("");
      setActionDue("");
      setNotice("Action added.");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the action — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--sp-24)" }}>
      {/* ------------------------------------------------ meetings card --- */}
      <section className="card" data-testid="meetings-card">
        <div className="pad" style={{ paddingBottom: 0, display: "block" }}>
          <div className="sect">
            <h2>Meetings &amp; minutes</h2>
            <div className="actions" style={{ margin: 0, display: "flex", gap: "var(--sp-12)" }}>
              <Pill tone="grey">{meetings.length}</Pill>
              {can.createMeeting && !creating ? (
                <button type="button" className="btn sm primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={14} /> Add meeting
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="pad" style={{ display: "grid", gap: "var(--sp-12)" }}>
          {error ? (
            <span className="form-error" role="alert">
              {error}
            </span>
          ) : null}
          {notice ? (
            <span role="status" style={{ color: "var(--ok)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>
              {notice}
            </span>
          ) : null}

          {creating && can.createMeeting ? (
            <form onSubmit={createMeeting} className="inset" style={{ display: "grid", gap: "var(--sp-12)" }}>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-held">Date and time</label>
                <input
                  id="mp-held"
                  type="datetime-local"
                  className="input"
                  value={heldAt || defaultSlot}
                  onChange={(e) => setHeldAt(e.target.value)}
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <span id="mp-attendees-lbl" style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>
                  Attendees
                </span>
                <select
                  multiple
                  size={5}
                  aria-labelledby="mp-attendees-lbl"
                  className="select"
                  value={attendance}
                  onChange={(e) => setAttendance(Array.from(e.target.selectedOptions).map((o) => o.value))}
                >
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-notes">Notes — help the minutes; at least 40 characters for generation</label>
                <textarea
                  id="mp-notes"
                  className="textarea"
                  rows={4}
                  value={meetingNotes}
                  onChange={(e) => setMeetingNotes(e.target.value)}
                  placeholder="Leave empty for a scheduled meeting, or capture the discussion now."
                />
              </div>
              <div style={{ display: "flex", gap: "var(--sp-12)", justifyContent: "flex-end" }}>
                <button type="button" className="btn ghost" onClick={() => setCreating(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? "Adding…" : meetingNotes.trim() ? "Log held meeting" : "Schedule meeting"}
                </button>
              </div>
            </form>
          ) : null}

          {meetings.length === 0 ? (
            <Empty
              title="No meetings yet"
              hint={
                can.createMeeting
                  ? "Add the first meeting — after it is held, notes become minutes and minutes become actions."
                  : "The chairperson convenes meetings; they will appear here when scheduled."
              }
              action={
                can.createMeeting ? (
                  <button type="button" className="btn sm" onClick={() => setCreating(true)}>
                    <Icon name="plus" size={14} /> Add meeting
                  </button>
                ) : undefined
              }
            />
          ) : (
            meetings.map((m) => <MeetingCard key={m.id} m={m} people={people} can={can} />)
          )}
        </div>
      </section>

      {/* ------------------------------------------------- actions card --- */}
      <section className="card" data-testid="actions-card">
        <div className="pad" style={{ paddingBottom: 0, display: "block" }}>
          <div className="sect">
            <h2>Actions</h2>
            <div className="actions" style={{ margin: 0, display: "flex", gap: "var(--sp-12)" }}>
              <Pill tone={open.length > 0 ? "amber" : "green"}>{open.length} open</Pill>
              {can.addAction && !addingAction ? (
                <button type="button" className="btn sm" onClick={() => setAddingAction(true)}>
                  <Icon name="plus" size={14} /> Add action
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="pad" style={{ display: "grid", gap: "var(--sp-12)" }}>
          {addingAction && can.addAction ? (
            <form onSubmit={createActionItem} className="inset" style={{ display: "grid", gap: "var(--sp-12)" }}>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="la-title">What must happen — required</label>
                <input
                  id="la-title"
                  className="input"
                  required
                  maxLength={200}
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  placeholder="e.g. Circularise the nodal officer list to all departments"
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-12)" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="la-owner">Owner</label>
                  <select
                    id="la-owner"
                    className="select"
                    value={actionOwner}
                    onChange={(e) => setActionOwner(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="la-due">Due date</label>
                  <input
                    id="la-due"
                    className="input"
                    type="date"
                    value={actionDue}
                    onChange={(e) => setActionDue(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "var(--sp-12)", justifyContent: "flex-end" }}>
                <button type="button" className="btn ghost" onClick={() => setAddingAction(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={busy || actionTitle.trim().length === 0}>
                  {busy ? "Adding…" : "Add action"}
                </button>
              </div>
            </form>
          ) : null}

          {actions.length === 0 ? (
            <Empty
              title="No actions tracked"
              hint="Actions arrive when minutes are signed, or someone adds one directly."
              action={
                can.addAction ? (
                  <button type="button" className="btn sm" onClick={() => setAddingAction(true)}>
                    <Icon name="plus" size={14} /> Add action
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="list" role="list" aria-label="Action items">
              {actions.map((a) => (
                <ActionRow
                  key={a.id}
                  a={a}
                  people={people}
                  actorId={actorId}
                  closeable={can.isChair || can.isHead || a.ownerId === actorId}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
