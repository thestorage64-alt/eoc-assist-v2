
import { randomBytes, createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import { query } from "@/lib/core/db";
import type { Actor, Membership, User } from "@/lib/contracts";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function createSession(userId: string): Promise<{ token: string; sessionId: string }> {
  const token = randomBytes(32).toString("base64url");
  const sessionId = crypto.randomUUID();
  const tokenHash = sha256Hex(token);
  const now = Date.now();
  await query(
    "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_seen_at, revoked_at) VALUES ($1,$2,$3,$4,$5,NULL)",
    [sessionId, userId, tokenHash, now, now]
  );
  return { token, sessionId };
}

export async function resolveActor(req: Request): Promise<Actor | null> {
  let token: string | null = null;
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  } else {
    token = parseCookie(req.headers.get("cookie"), "eoc_session");
  }
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const res = await query<any>(
    `SELECT s.id AS session_id, s.user_id, u.id, u.email, u.name, u.designation, u.phone, u.global_role, u.status
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [tokenHash]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  if (row.status !== "active") return null;
  const now = Date.now();
  await query("UPDATE auth_sessions SET last_seen_at = $1 WHERE id = $2", [now, row.session_id]);
  const memRes = await query<any>(
    "SELECT cell_id, role FROM memberships WHERE user_id = $1",
    [row.user_id]
  );
  const memberships: Membership[] = memRes.rows.map((m: any) => ({
    cellId: m.cell_id,
    role: m.role as "head" | "member",
  }));
  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    designation: row.designation,
    phone: row.phone,
    role: row.global_role as User["role"],
    status: row.status as User["status"],
  };
  return { user, memberships };
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set("eoc_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set("eoc_session", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query("UPDATE auth_sessions SET revoked_at = $1 WHERE id = $2", [Date.now(), sessionId]);
}
