export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { clearSessionCookie, revokeSession } from "@/lib/core/auth";
import { query } from "@/lib/core/db";
import { createHash } from "node:crypto";

export async function POST(req: Request) {
  const token = extractToken(req);
  if (token) {
    const hash = createHash("sha256").update(token).digest("hex");
    const r = await query<any>("SELECT id FROM auth_sessions WHERE token_hash = $1", [hash]);
    if (r.rowCount && r.rows[0]?.id) {
      await revokeSession(r.rows[0].id);
    }
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "eoc_session") return decodeURIComponent(rest.join("="));
  }
  return null;
}
