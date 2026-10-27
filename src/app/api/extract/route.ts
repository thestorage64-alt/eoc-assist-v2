export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/core/auth";
import {
  MAX_UPLOAD_BYTES,
  ExtractError,
  extractText,
  extractFromImage,
  isImage,
  isSupportedFile,
} from "@/lib/files/extract";

/**
 * POST /api/extract — multipart file in, text out.
 *
 * PDF → text layer, DOCX → raw text, TXT/MD → as-is, images → vision model.
 * The method is returned so the interface can be honest about where the text came
 * from, and the user reviews it before a circular is created.
 */
export async function POST(req: Request) {
  const actor = await resolveActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Keep the file under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` },
      { status: 413 },
    );
  }
  if (!isSupportedFile(file.name)) {
    return NextResponse.json(
      { error: "Use a PDF, Word document, plain text file or a photo of the circular." },
      { status: 415 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = isImage(file.name)
      ? await extractFromImage(buffer, file.type || "image/jpeg")
      : await extractText(buffer, file.name);

    return NextResponse.json({
      ok: true,
      text: result.text,
      method: result.method,
      pages: result.pages ?? null,
      chars: result.text.length,
      warning: result.warning ?? null,
      filename: file.name,
    });
  } catch (e) {
    if (e instanceof ExtractError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "Could not read that file.";
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
  }
}
