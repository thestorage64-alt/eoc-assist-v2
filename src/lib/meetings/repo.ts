import "server-only";
import { randomUUID } from "node:crypto";
import { query, getPool } from "@/lib/core/db";
import type { Meeting, ActionItem, ProposedAction } from "@/lib/contracts";

function parseJsonb(v: any): any {
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

function toProposedAction(pa: any): ProposedAction {
  return {
    title: String(pa?.title ?? ""),
    ownerName: String(pa?.owner_name ?? pa?.ownerName ?? ""),
    dueDate: (pa?.due_date ?? pa?.dueDate ?? null) as string | null,
  };
}

function rowToMeeting(r: any): Meeting {
  const raw = parseJsonb(r.proposed_actions);
  const proposed = Array.isArray(raw) ? raw.map(toProposedAction) : [];
  return {
    id: r.id,
    circularId: r.circular_id,
    heldAt: Number(r.held_at),
    attendees: parseJsonb(r.attendees) ?? [],
    notes: r.notes ?? "",
    status: r.status,
    minutesMd: r.minutes_md ?? null,
    decisions: parseJsonb(r.decisions) ?? [],
    proposedActions: proposed,
    signedBy: r.signed_by ?? null,
    signedAt: r.signed_at == null ? null : Number(r.signed_at),
    createdAt: Number(r.created_at),
  };
}

function rowToAction(r: any): ActionItem {
  return {
    id: r.id,
    circularId: r.circular_id,
    meetingId: r.meeting_id ?? null,
    title: r.title,
    ownerId: r.owner_id ?? null,
    dueAt: r.due_at == null ? null : Number(r.due_at),
    status: r.status,
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
    createdAt: Number(r.created_at),
  };
}

export async function createMeeting(
  actor: { user: { id: string } },
  circularId: string,
  input: { heldAt: number; attendees: string[]; notes: string; status: "scheduled" | "held" }
): Promise<Meeting> {
  const id = randomUUID();
  const now = Date.now();
  await query(
    `INSERT INTO meetings (id, circular_id, held_at, attendees, notes, status, minutes_md, decisions, signed_by, signed_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,'[]'::jsonb,NULL,NULL,$7)`,
    [id, circularId, input.heldAt, JSON.stringify(input.attendees ?? []), input.notes ?? "", input.status, now]
  );
  const res = await query<any>("SELECT * FROM meetings WHERE id = $1", [id]);
  return rowToMeeting(res.rows[0]);
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  const res = await query<any>("SELECT * FROM meetings WHERE id = $1", [id]);
  if (res.rowCount === 0) return null;
  return rowToMeeting(res.rows[0]);
}

export async function listMeetings(circularId: string): Promise<Meeting[]> {
  const res = await query<any>("SELECT * FROM meetings WHERE circular_id = $1 ORDER BY created_at DESC", [circularId]);
  return res.rows.map(rowToMeeting);
}

export async function updateMeetingMinutes(
  id: string,
  minutesMd: string,
  decisions: string[],
  proposedActions?: any[],
  notes?: string
): Promise<Meeting> {
  const params2: any[] = [minutesMd, JSON.stringify(decisions ?? []), JSON.stringify(proposedActions ?? [])];
  const sets2: string[] = ["minutes_md = $1", "decisions = $2", "proposed_actions = $3", "status = 'held'"];
  if (notes !== undefined) {
    params2.push(notes);
    sets2.push(`notes = $${params2.length}`);
  }
  params2.push(id);
  const sql = `UPDATE meetings SET ${sets2.join(", ")} WHERE id = $${params2.length} RETURNING *`;
  const res = await query<any>(sql, params2);
  return rowToMeeting(res.rows[0]);
}

export async function signMeeting(
  meetingId: string,
  signedBy: string,
  proposed: { title: string; ownerId: string | null; dueAt: number | null }[]
): Promise<ActionItem[]> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error("meeting not found");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const now = Date.now();
    await client.query(
      "UPDATE meetings SET status = 'signed', signed_by = $1, signed_at = $2 WHERE id = $3",
      [signedBy, now, meetingId]
    );
    const created: ActionItem[] = [];
    for (const p of proposed) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO actions (id, circular_id, meeting_id, title, owner_id, due_at, status, completed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'open',NULL,$7)`,
        [id, meeting.circularId, meetingId, p.title, p.ownerId, p.dueAt, now]
      );
      created.push({
        id,
        circularId: meeting.circularId,
        meetingId,
        title: p.title,
        ownerId: p.ownerId,
        dueAt: p.dueAt,
        status: "open",
        completedAt: null,
        createdAt: now,
      });
    }
    await client.query("COMMIT");
    return created;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getAction(id: string): Promise<ActionItem | null> {
  const res = await query<any>("SELECT * FROM actions WHERE id = $1", [id]);
  if (res.rowCount === 0) return null;
  return rowToAction(res.rows[0]);
}

export async function createAction(
  circularId: string,
  meetingId: string | null,
  title: string,
  ownerId: string | null,
  dueAt: number | null
): Promise<ActionItem> {
  const id = randomUUID();
  const now = Date.now();
  await query(
    `INSERT INTO actions (id, circular_id, meeting_id, title, owner_id, due_at, status, completed_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'open',NULL,$7)`,
    [id, circularId, meetingId, title, ownerId, dueAt, now]
  );
  const res = await query<any>("SELECT * FROM actions WHERE id = $1", [id]);
  return rowToAction(res.rows[0]);
}

export async function updateActionStatus(id: string, status: "open" | "done"): Promise<ActionItem> {
  const now = Date.now();
  if (status === "done") {
    await query("UPDATE actions SET status = 'done', completed_at = $1 WHERE id = $2", [now, id]);
  } else {
    await query("UPDATE actions SET status = 'open', completed_at = NULL WHERE id = $1", [id]);
  }
  const res = await query<any>("SELECT * FROM actions WHERE id = $1", [id]);
  return rowToAction(res.rows[0]);
}
