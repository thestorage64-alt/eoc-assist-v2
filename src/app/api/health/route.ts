export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { query } from "@/lib/core/db";

export async function GET() {
  let database = false;
  try {
    await query("SELECT 1");
    database = true;
  } catch {
    database = false;
  }
  // The canonical name is EOC_LLM_API_KEY; GROQ_API_KEY is the legacy fallback the
  // AI client also accepts. Reporting "not configured" while the client works is a
  // lie the UI then repeats, so both are checked.
  const aiConfigured = Boolean(process.env.EOC_LLM_API_KEY || process.env.GROQ_API_KEY);
  return NextResponse.json({ ok: true, database, aiConfigured });
}
