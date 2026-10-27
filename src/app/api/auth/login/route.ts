export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/core/auth";
import { query } from "@/lib/core/db";
import { verifyPassword } from "@/lib/core/password";
import type { Membership, User } from "@/lib/contracts";

const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const key = `${clientIp(req)}|${email}`;
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && now < rec.resetAt) {
    if (rec.count >= 10) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }
    rec.count += 1;
  } else {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
  }

  const res = await query<any>(
    "SELECT id, email, password_hash, name, designation, phone, global_role, status FROM users WHERE email = $1",
    [email]
  );
  if (res.rowCount === 0) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const row = res.rows[0];
  if (row.status !== "active" || !verifyPassword(password, row.password_hash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const { token } = await createSession(row.id);
  const memRes = await query<any>("SELECT cell_id, role FROM memberships WHERE user_id = $1", [row.id]);
  const memberships: Membership[] = memRes.rows.map((m: any) => ({
    cellId: m.cell_id,
    role: m.role,
  }));
  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    designation: row.designation,
    phone: row.phone,
    role: row.global_role,
    status: row.status,
  };

  const response = NextResponse.json({ ok: true, user, memberships });
  setSessionCookie(response, token);
  return response;
}
