import { CELL_SPEC, type Classification, type Confidence } from "@/lib/contracts";

const CELL_IDS = new Set(CELL_SPEC.map((c) => c.id));
const ALLOWED_KEYS = new Set([
  "primaryCell",
  "relatedCells",
  "primarySdg",
  "relatedSdgs",
  "reason",
  "confidence",
  "tags",
]);

const CONFIDENCES: ReadonlySet<string> = new Set(["high", "medium", "low"]);

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export function parseClassification(
  value: unknown
): { ok: true; value: Classification } | { ok: false; error: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "value must be an object" };
  }
  const obj = value as Record<string, unknown>;

  for (const k of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(k)) {
      return { ok: false, error: `unknown key: ${k}` };
    }
  }
  for (const k of ALLOWED_KEYS) {
    if (!(k in obj)) {
      return { ok: false, error: `missing key: ${k}` };
    }
  }

  const primaryCell = obj.primaryCell;
  if (typeof primaryCell !== "string" || !CELL_IDS.has(primaryCell)) {
    return { ok: false, error: "invalid primaryCell" };
  }

  const relatedCells = obj.relatedCells;
  if (!Array.isArray(relatedCells)) {
    return { ok: false, error: "relatedCells must be an array" };
  }
  const rcSet = new Set<string>();
  for (const c of relatedCells) {
    if (typeof c !== "string" || !CELL_IDS.has(c)) {
      return { ok: false, error: "invalid relatedCell" };
    }
    if (c === primaryCell) {
      return { ok: false, error: "relatedCells must not include primaryCell" };
    }
    if (rcSet.has(c)) {
      return { ok: false, error: "duplicate relatedCell" };
    }
    rcSet.add(c);
  }

  const primarySdg = obj.primarySdg;
  if (!isInt(primarySdg) || primarySdg < 1 || primarySdg > 17) {
    return { ok: false, error: "invalid primarySdg" };
  }

  const relatedSdgs = obj.relatedSdgs;
  if (!Array.isArray(relatedSdgs)) {
    return { ok: false, error: "relatedSdgs must be an array" };
  }
  const rsSet = new Set<number>();
  for (const s of relatedSdgs) {
    if (!isInt(s) || s < 1 || s > 17) {
      return { ok: false, error: "invalid relatedSdg" };
    }
    if (s === primarySdg) {
      return { ok: false, error: "relatedSdgs must not include primarySdg" };
    }
    if (rsSet.has(s)) {
      return { ok: false, error: "duplicate relatedSdg" };
    }
    rsSet.add(s);
  }

  const reason = obj.reason;
  if (typeof reason !== "string") {
    return { ok: false, error: "reason must be a string" };
  }
  const trimmed = reason.trim();
  if (trimmed.length < 20 || trimmed.length > 600) {
    return { ok: false, error: "reason length out of range" };
  }

  const confidence = obj.confidence;
  if (typeof confidence !== "string" || !CONFIDENCES.has(confidence)) {
    return { ok: false, error: "invalid confidence" };
  }

  const tags = obj.tags;
  if (!Array.isArray(tags) || tags.length > 8) {
    return { ok: false, error: "tags must be array of <=8" };
  }
  for (const t of tags) {
    if (typeof t !== "string" || t.length > 32) {
      return { ok: false, error: "invalid tag" };
    }
  }

  const valueOut: Classification = {
    primaryCell,
    relatedCells: [...relatedCells] as string[],
    primarySdg: primarySdg as number,
    relatedSdgs: [...relatedSdgs] as number[],
    reason,
    confidence: confidence as Confidence,
    tags: [...tags] as string[],
  };
  return { ok: true, value: valueOut };
}