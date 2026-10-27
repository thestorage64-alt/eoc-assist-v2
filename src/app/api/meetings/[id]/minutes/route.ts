export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { canReadCircular, canSignMinutes } from "@/lib/core/permissions";
import { audit } from "@/lib/core/audit";
import { getCircular } from "@/lib/circulars/repo";
import { getMeeting, updateMeetingMinutes } from "@/lib/meetings/repo";
import { parseMinutes, deriveFallbackMinutes } from "@/lib/meetings/minutes";
import { buildPrompt } from "@/lib/meetings/prompt";
import { callLLM } from "@/lib/ai/client";
import { AiNotConfigured, AiTimeout, AiFailed, AiInvalidOutput } from "@/lib/ai/client";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const meeting = await getMeeting(id);
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const circular = await getCircular(meeting.circularId);
  if (!circular || !canReadCircular(actor, { cellId: circular.cellId, confidential: circular.confidential })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canSignMinutes(actor, circular.cellId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const notes = body?.notes != null ? String(body.notes) : meeting.notes;
  if (notes.trim().length < 40) {
    return NextResponse.json({ error: "notes_too_short", code: "notes_too_short" }, { status: 400 });
  }

  // Manual path: the AI is optional, the meeting is not. A head who cannot get a
  // draft must still be able to record what was decided — otherwise a provider
  // outage blocks the entire minutes -> actions journey.
  if (body?.manual === true) {
    const fallback = deriveFallbackMinutes(notes);
    const minutesMd =
      "**Minutes recorded by " + actor.user.name + " — not AI-generated**\n\n" + fallback.minutes_md;

    await updateMeetingMinutes(
      meeting.id,
      minutesMd,
      fallback.decisions,
      fallback.proposed_actions,
      body?.notes != null ? notes : undefined,
    );

    await audit({
      actorId: actor.user.id,
      action: "minutes.recorded_manually",
      entityType: "meeting",
      entityId: meeting.id,
      cellId: circular.cellId,
      detail: { actions: fallback.proposed_actions.length },
    });

    return NextResponse.json({
      ok: true,
      source: "manual",
      minutesMd,
      decisions: fallback.decisions,
      proposedActions: fallback.proposed_actions.map((a) => ({
        title: a.title,
        ownerName: a.owner_name,
        dueDate: a.due_date,
      })),
    });
  }

  const systemPrompt = buildPrompt(notes);
  const userPrompt = "Meeting notes:\n" + notes + "\nRespond with the JSON object only.";

  try {
    const content = await callLLM(systemPrompt, userPrompt);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AiInvalidOutput("invalid JSON");
    }
    const validated = parseMinutes(parsed);
    if (!validated.ok) {
      throw new AiInvalidOutput(validated.error);
    }

    await updateMeetingMinutes(meeting.id, validated.value.minutes_md, validated.value.decisions, validated.value.proposed_actions, body?.notes != null ? notes : undefined);

    await audit({
      actorId: actor.user.id,
      action: "minutes.generated",
      entityType: "meeting",
      entityId: meeting.id,
      cellId: circular.cellId,
      detail: { proposed_actions: validated.value.proposed_actions },
    });

    return NextResponse.json({
      ok: true,
      minutesMd: validated.value.minutes_md,
      decisions: validated.value.decisions,
      // Entries are snake_case in storage; the client type declares camelCase.
      // Without this mapping every owner and due date in the response was undefined.
      proposedActions: validated.value.proposed_actions.map((a) => ({
        title: a.title,
        ownerName: a.owner_name,
        dueDate: a.due_date,
      })),
    });
  } catch (e: any) {
    let status = 502;
    let code = "ai_failed";
    if (e instanceof AiNotConfigured) { status = 503; code = "ai_not_configured"; }
    else if (e instanceof AiTimeout) { status = 504; code = "ai_timeout"; }
    else if (e instanceof AiInvalidOutput) { status = 422; code = "ai_invalid_output"; }
    else if (e instanceof AiFailed) { status = 502; code = "ai_failed"; }
    else if (e && e.name === "AiNotConfigured") { status = 503; code = "ai_not_configured"; }
    else if (e && e.name === "AiTimeout") { status = 504; code = "ai_timeout"; }
    else if (e && e.name === "AiInvalidOutput") { status = 422; code = "ai_invalid_output"; }
    else { status = 502; code = "ai_failed"; }

    await audit({
      actorId: actor.user.id,
      action: "minutes.failed",
      entityType: "meeting",
      entityId: meeting.id,
      cellId: circular.cellId,
      detail: { reason: code },
    }).catch(() => {});

    return NextResponse.json({ error: code, code }, { status });
  }
}
