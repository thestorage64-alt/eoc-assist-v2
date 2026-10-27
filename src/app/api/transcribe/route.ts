export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import { ExtractError, transcribeAudio } from "@/lib/files/extract";

const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // provider limit is 25 MB

const ALLOWED = [".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".flac", ".mpga"];

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

/**
 * POST /api/transcribe — a recording in, text out, for the meeting notes field.
 * The transcript lands in the notes box for a human to correct before minutes
 * are drafted.
 */
export async function POST(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the recording as multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No recording was attached." }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Keep the recording under 24 MB." }, { status: 413 });
  }
  if (!ALLOWED.includes(extOf(file.name))) {
    return NextResponse.json(
      { error: `Unsupported audio type. Use ${ALLOWED.join(", ")}.` },
      { status: 415 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await transcribeAudio(buffer, file.name, file.type || "audio/wav");
    return NextResponse.json({ ok: true, text, chars: text.length, filename: file.name });
  } catch (e) {
    if (e instanceof ExtractError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "Transcription failed.";
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
  }
}
