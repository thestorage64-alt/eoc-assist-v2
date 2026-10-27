export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canReadCircular } from "@/lib/core/permissions";
import { isPrincipal } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular, getClassification, setSuggestion } from "@/lib/circulars/repo";
import { buildPrompt } from "@/lib/circulars/prompt";
import { parseClassification } from "@/lib/circulars/classify";
import { callLLM } from "@/lib/ai/client";
import { AiNotConfigured, AiTimeout, AiFailed, AiInvalidOutput } from "@/lib/ai/client";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const circular = await getCircular(id);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (isPrincipal(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const textLen = Math.max(circular.title.trim().length, circular.body.trim().length);
  if (textLen < 40) {
    return NextResponse.json({ error: "body or title must have at least 40 characters" }, { status: 400 });
  }

  const systemPrompt = buildPrompt();
  const userPrompt = `Circular title: ${circular.title}\nCircular body: ${circular.body}\nRespond with the JSON object only.`;

  try {
    const content = await callLLM(systemPrompt, userPrompt);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AiInvalidOutput("invalid JSON");
    }
    const validated = parseClassification(parsed);
    if (!validated.ok) {
      throw new AiInvalidOutput(validated.error);
    }
    await setSuggestion(id, validated.value);
    await audit({
      actorId: actor.user.id,
      action: "classification.suggested",
      entityType: "circular",
      entityId: id,
      cellId: circular.cellId,
      detail: {},
    });
    return NextResponse.json({ ok: true, suggestion: validated.value });
  } catch (e: any) {
    let status = 502;
    let code = "ai_failed";
    if (e instanceof AiNotConfigured) { status = 503; code = "ai_not_configured"; }
    else if (e instanceof AiTimeout) { status = 504; code = "ai_timeout"; }
    else if (e instanceof AiInvalidOutput) { status = 422; code = "ai_invalid_output"; }
    else { status = 502; code = "ai_failed"; }

    await audit({
      actorId: actor.user.id,
      action: "classification.failed",
      entityType: "circular",
      entityId: id,
      cellId: circular.cellId,
      detail: { reason: code },
    }).catch(() => {});

    return NextResponse.json({ error: code, code }, { status });
  }
}