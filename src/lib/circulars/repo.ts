
import { randomUUID } from "node:crypto";
import { query } from "@/lib/core/db";
import type { Circular, CircularDetail, Classification, ClassificationRecord, Meeting, ActionItem, DocumentRecord } from "@/lib/contracts";
import type { Actor } from "@/lib/contracts";

function rowToCircular(r: any): Circular {
  return {
    id: r.id,
    ref: r.ref,
    title: r.title,
    body: r.body ?? "",
    source: r.source ?? "",
    receivedAt: Number(r.received_at),
    dueAt: r.due_at == null ? null : Number(r.due_at),
    state: r.state,
    cellId: r.cell_id ?? null,
    assignedTo: r.assigned_to ?? null,
    createdBy: r.created_by,
    confidential: Boolean(r.confidential),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function parseJsonb(v: any): any {
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

export async function createCircular(
  actor: Actor,
  input: {
    title: string;
    body?: string;
    source?: string;
    due_at?: number | null;
    confidential?: boolean;
    cell_id?: string | null;
  }
): Promise<Circular> {
  const now = Date.now();
  const title = input.title;
  const body = input.body ?? "";
  const source = input.source ?? "";
  const dueAt = input.due_at ?? null;
  const confidential = Boolean(input.confidential);
  const cellId = input.cell_id ?? null;

  const year = new Date(now).getFullYear();

  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Highest existing suffix + 1, not COUNT(*). Counting produced EOC-2026-0011
    // in a register already at 0110, and would collide once count and suffix met.
    const maxRes = await query<any>(
      "SELECT COALESCE(MAX(NULLIF(SUBSTRING(ref FROM '[0-9]+$'), '')::int), 0) AS m FROM circulars WHERE ref LIKE $1",
      [`EOC-${year}-%`]
    );
    const seq = Number(maxRes.rows[0]?.m ?? 0) + 1;
    const ref = `EOC-${year}-${String(seq).padStart(4, "0")}`;
    const id = randomUUID();
    try {
      await query(
        `INSERT INTO circulars (id, ref, title, body, source, received_at, due_at, state, cell_id, assigned_to, created_by, confidential, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'intake',$8,NULL,$9,$10,$11,$11)`,
        [id, ref, title, body, source, now, dueAt, cellId, actor.user.id, confidential, now]
      );
      await query(
        "INSERT INTO classifications (circular_id, suggestion, final, verdict, decided_by, decided_at) VALUES ($1,NULL,NULL,NULL,NULL,NULL) ON CONFLICT (circular_id) DO NOTHING",
        [id]
      );
      const res = await query<any>("SELECT * FROM circulars WHERE id = $1", [id]);
      return rowToCircular(res.rows[0]);
    } catch (e: any) {
      lastErr = e;
      if (e?.code === "23505" && attempt === 0) continue;
      throw e;
    }
  }
  throw lastErr;
}

export interface ListFilters {
  state?: string | null;
  cell?: string | null;
  q?: string | null;
}

export async function listCirculars(actor: Actor, filters: ListFilters = {}): Promise<Circular[]> {
  const params: any[] = [actor.user.id, isPrincipal(actor), isChair(actor)];
  let where = "(c.confidential = false OR $2::boolean OR $3::boolean OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $1 AND m.cell_id = c.cell_id))";

  if (filters.state) {
    params.push(filters.state);
    where += ` AND c.state = $${params.length}`;
  }
  if (filters.cell) {
    params.push(filters.cell);
    where += ` AND c.cell_id = $${params.length}`;
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where += ` AND (c.title ILIKE $${params.length} OR c.body ILIKE $${params.length})`;
  }

  const sql = `SELECT c.* FROM circulars c WHERE ${where} ORDER BY c.created_at DESC LIMIT 100`;
  const res = await query<any>(sql, params);
  return res.rows.map(rowToCircular);
}

function isPrincipal(a: Actor): boolean {
  return a.user.role === "principal";
}
function isChair(a: Actor): boolean {
  return a.user.role === "chair";
}

export async function getCircular(id: string): Promise<Circular | null> {
  const res = await query<any>("SELECT * FROM circulars WHERE id = $1", [id]);
  if (res.rowCount === 0) return null;
  return rowToCircular(res.rows[0]);
}

export async function updateCircular(
  id: string,
  patch: { title?: string; body?: string; due_at?: number | null; assigned_to?: string | null }
): Promise<Circular> {
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.title !== undefined) {
    params.push(patch.title);
    sets.push(`title = $${params.length}`);
  }
  if (patch.body !== undefined) {
    params.push(patch.body);
    sets.push(`body = $${params.length}`);
  }
  if (patch.due_at !== undefined) {
    params.push(patch.due_at);
    sets.push(`due_at = $${params.length}`);
  }
  if (patch.assigned_to !== undefined) {
    params.push(patch.assigned_to);
    sets.push(`assigned_to = $${params.length}`);
  }
  params.push(Date.now());
  sets.push(`updated_at = $${params.length}`);
  params.push(id);
  const sql = `UPDATE circulars SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`;
  const res = await query<any>(sql, params);
  return rowToCircular(res.rows[0]);
}

export async function getClassification(circularId: string): Promise<ClassificationRecord> {
  const res = await query<any>("SELECT * FROM classifications WHERE circular_id = $1", [circularId]);
  if (res.rowCount === 0) {
    return { suggestion: null, final: null, verdict: null, decidedBy: null, decidedAt: null };
  }
  const r = res.rows[0];
  return {
    suggestion: parseJsonb(r.suggestion) as Classification | null,
    final: parseJsonb(r.final) as Classification | null,
    verdict: (r.verdict as "confirmed" | "corrected") ?? null,
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at == null ? null : Number(r.decided_at),
  };
}

export async function setSuggestion(circularId: string, suggestion: Classification): Promise<void> {
  await query(
    `INSERT INTO classifications (circular_id, suggestion, final, verdict, decided_by, decided_at)
     VALUES ($1, $2, NULL, NULL, NULL, NULL)
     ON CONFLICT (circular_id) DO UPDATE SET suggestion = EXCLUDED.suggestion`,
    [circularId, JSON.stringify(suggestion)]
  );
}

export async function setFinal(
  circularId: string,
  final: Classification,
  verdict: "confirmed" | "corrected",
  decidedBy: string,
  decidedAt: number
): Promise<void> {
  await query(
    `UPDATE classifications SET final = $2, verdict = $3, decided_by = $4, decided_at = $5
     WHERE circular_id = $1`,
    [circularId, JSON.stringify(final), verdict, decidedBy, decidedAt]
  );
  // ensure row exists
  await query(
    `INSERT INTO classifications (circular_id, suggestion, final, verdict, decided_by, decided_at)
     VALUES ($1, NULL, $2, $3, $4, $5)
     ON CONFLICT (circular_id) DO NOTHING`,
    [circularId, JSON.stringify(final), verdict, decidedBy, decidedAt]
  );
}

export async function getMeetings(circularId: string): Promise<Meeting[]> {
  const res = await query<any>(
    "SELECT * FROM meetings WHERE circular_id = $1 ORDER BY created_at DESC",
    [circularId]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    circularId: r.circular_id,
    heldAt: Number(r.held_at),
    attendees: parseJsonb(r.attendees) ?? [],
    notes: r.notes ?? "",
    status: r.status,
    minutesMd: r.minutes_md ?? null,
    decisions: parseJsonb(r.decisions) ?? [],
    proposedActions: parseJsonb(r.proposed_actions) ?? [],
    signedBy: r.signed_by ?? null,
    signedAt: r.signed_at == null ? null : Number(r.signed_at),
    createdAt: Number(r.created_at),
  }));
}

export async function getActions(circularId: string): Promise<ActionItem[]> {
  const res = await query<any>(
    "SELECT * FROM actions WHERE circular_id = $1 ORDER BY created_at DESC",
    [circularId]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    circularId: r.circular_id,
    meetingId: r.meeting_id ?? null,
    title: r.title,
    ownerId: r.owner_id ?? null,
    dueAt: r.due_at == null ? null : Number(r.due_at),
    status: r.status,
    completedAt: r.completed_at == null ? null : Number(r.completed_at),
    createdAt: Number(r.created_at),
  }));
}

export async function getDocuments(circularId: string): Promise<DocumentRecord[]> {
  const res = await query<any>(
    "SELECT * FROM documents WHERE circular_id = $1 ORDER BY created_at DESC",
    [circularId]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    circularId: r.circular_id,
    kind: r.kind,
    version: Number(r.version),
    contentMd: r.content_md,
    createdBy: r.created_by ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at == null ? null : Number(r.approved_at),
    createdAt: Number(r.created_at),
  }));
}

export async function hasApprovedReport(circularId: string): Promise<boolean> {
  const res = await query<any>(
    "SELECT 1 FROM documents WHERE circular_id = $1 AND approved_at IS NOT NULL AND kind ILIKE '%report%' LIMIT 1",
    [circularId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getCellHead(cellId: string): Promise<string | null> {
  const res = await query<any>(
    "SELECT u.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.cell_id = $1 AND m.role = 'head' LIMIT 1",
    [cellId]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0].id;
}
