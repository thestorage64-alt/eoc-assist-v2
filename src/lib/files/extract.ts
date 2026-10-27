import "server-only";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/**
 * Turn an uploaded circular into text.
 *
 * One path per format, and every path reports which one produced the text, so the
 * UI can say where it came from and the user can check it before saving. A PDF
 * that has no text layer is reported as such rather than returning "".
 */

export type ExtractMethod = "text" | "docx" | "pdf" | "vision";

export interface ExtractResult {
  text: string;
  method: ExtractMethod;
  pages?: number;
  warning?: string;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const TEXT_EXT = [".txt", ".md", ".markdown", ".csv"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export function isSupportedFile(name: string): boolean {
  const e = extOf(name);
  return e === ".pdf" || e === ".docx" || TEXT_EXT.includes(e) || IMAGE_EXT.includes(e);
}

export function isImage(name: string): boolean {
  return IMAGE_EXT.includes(extOf(name));
}

export async function extractText(buffer: Buffer, filename: string): Promise<ExtractResult> {
  const ext = extOf(filename);

  if (TEXT_EXT.includes(ext)) {
    return { text: buffer.toString("utf8").trim(), method: "text" };
  }

  if (ext === ".docx") {
    const parsed = await mammoth.extractRawText({ buffer });
    const text = (parsed.value ?? "").trim();
    if (!text) {
      throw new ExtractError("That Word file has no readable text.", 422);
    }
    return { text, method: "docx", warning: parsed.messages?.length ? "Some formatting was dropped." : undefined };
  }

  if (ext === ".pdf") {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text ?? "").trim();
    if (text.length < 40) {
      // Scanned PDF: there is no text layer. Say so honestly; the caller can
      // offer the image path or ask the user to paste the text.
      throw new ExtractError(
        "This PDF looks scanned — it has no text layer. Upload it as page images, or paste the text.",
        422,
      );
    }
    return { text, method: "pdf", pages: parsed.numpages };
  }

  if (IMAGE_EXT.includes(ext)) {
    throw new ExtractError("Images are read by the vision path, not this one.", 415);
  }

  throw new ExtractError(`Unsupported file type "${ext || "unknown"}".`, 415);
}

/** Read text out of an image (or a photographed circular) with a vision model. */
export async function extractFromImage(buffer: Buffer, mime: string): Promise<ExtractResult> {
  const key = process.env.EOC_LLM_API_KEY || process.env.GROQ_API_KEY || "";
  if (!key) throw new ExtractError("AI is not configured, so images cannot be read here.", 503);

  const base = (process.env.EOC_LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  // No default model id: providers rotate them, and a wrong id fails with a 404
  // that looks like a broken feature. Set EOC_VISION_MODEL when a vision model is
  // actually available on the account.
  const model = process.env.EOC_VISION_MODEL || "";
  if (!model) {
    throw new ExtractError(
      "This deployment has no vision model, so photos can't be read. Upload a PDF or Word file, or paste the text.",
      415,
    );
  }
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Transcribe every word of this institutional circular exactly. Preserve headings, " +
                "dates, reference numbers and amounts. Output the text only — no commentary.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ExtractError(`The vision model could not read that image (${res.status}). ${detail.slice(0, 160)}`, 502);
  }

  const data = await res.json().catch(() => null);
  const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
  if (text.length < 20) {
    throw new ExtractError("No readable text was found in that image.", 422);
  }
  return { text, method: "vision" };
}

export class ExtractError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ExtractError";
    this.status = status;
  }
}

/** Transcribe an audio recording with Whisper through the same provider. */
export async function transcribeAudio(buffer: Buffer, filename: string, mime: string): Promise<string> {
  const key = process.env.EOC_LLM_API_KEY || process.env.GROQ_API_KEY || "";
  if (!key) throw new ExtractError("AI is not configured, so audio cannot be transcribed here.", 503);

  const base = (process.env.EOC_LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.EOC_WHISPER_MODEL || "whisper-large-v3";

  const form = new FormData();
  form.append("model", model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime || "audio/wav" }), filename);

  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ExtractError(`Transcription failed (${res.status}). ${detail.slice(0, 160)}`, 502);
  }

  const data = await res.json().catch(() => null);
  const text = String(data?.text ?? "").trim();
  if (text.length < 10) {
    throw new ExtractError("No speech was recognised in that recording.", 422);
  }
  return text;
}
