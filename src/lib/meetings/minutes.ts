export interface MinutesProposedAction {
  title: string;
  owner_name: string;
  due_date: string | null;
}

export interface MinutesPayload {
  minutes_md: string;
  decisions: string[];
  proposed_actions: MinutesProposedAction[];
}

const ALLOWED_TOP_KEYS = new Set(["minutes_md", "decisions", "proposed_actions"]);
const ALLOWED_ACTION_KEYS = new Set(["title", "owner_name", "due_date"]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function parseMinutes(
  value: unknown
): { ok: true; value: MinutesPayload } | { ok: false; error: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "value must be an object" };
  }
  const obj = value as Record<string, unknown>;

  for (const k of Object.keys(obj)) {
    if (!ALLOWED_TOP_KEYS.has(k)) {
      return { ok: false, error: `unknown key: ${k}` };
    }
  }
  for (const k of ALLOWED_TOP_KEYS) {
    if (!(k in obj)) {
      return { ok: false, error: `missing key: ${k}` };
    }
  }

  const minutes_md = obj.minutes_md;
  if (typeof minutes_md !== "string") {
    return { ok: false, error: "minutes_md must be a string" };
  }
  if (minutes_md.length < 100 || minutes_md.length > 8000) {
    return { ok: false, error: "minutes_md length out of range" };
  }

  const decisions = obj.decisions;
  if (!Array.isArray(decisions)) {
    return { ok: false, error: "decisions must be an array" };
  }
  if (decisions.length < 1 || decisions.length > 12) {
    return { ok: false, error: "decisions count out of range" };
  }
  for (const d of decisions) {
    if (typeof d !== "string") {
      return { ok: false, error: "decision must be a string" };
    }
  }

  const proposed_actions = obj.proposed_actions;
  if (!Array.isArray(proposed_actions)) {
    return { ok: false, error: "proposed_actions must be an array" };
  }
  if (proposed_actions.length < 0 || proposed_actions.length > 12) {
    return { ok: false, error: "proposed_actions count out of range" };
  }

  const parsedActions: MinutesProposedAction[] = [];
  for (const a of proposed_actions) {
    if (a === null || typeof a !== "object" || Array.isArray(a)) {
      return { ok: false, error: "action must be an object" };
    }
    const ao = a as Record<string, unknown>;
    for (const k of Object.keys(ao)) {
      if (!ALLOWED_ACTION_KEYS.has(k)) {
        return { ok: false, error: `unknown key: ${k}` };
      }
    }
    for (const k of ALLOWED_ACTION_KEYS) {
      if (!(k in ao)) {
        return { ok: false, error: `missing key: ${k}` };
      }
    }
    const title = ao.title;
    if (typeof title !== "string" || title.length < 5 || title.length > 160) {
      return { ok: false, error: "action title length out of range" };
    }
    const owner_name = ao.owner_name;
    if (typeof owner_name !== "string") {
      return { ok: false, error: "owner_name must be a string" };
    }
    const due_date = ao.due_date;
    if (due_date !== null && (typeof due_date !== "string" || !isValidISODate(due_date))) {
      return { ok: false, error: "invalid due_date" };
    }
    parsedActions.push({ title, owner_name, due_date: due_date as string | null });
  }

  return {
    ok: true,
    value: {
      minutes_md,
      decisions: [...decisions] as string[],
      proposed_actions: parsedActions,
    },
  };
}

export function resolveOwner(
  name: unknown,
  users: Array<{ id: string; name: string }> | any
): { id: string | null; ambiguous: boolean } {
  const target = String(name ?? "").trim().toLowerCase();
  if (!target) return { id: null, ambiguous: false };
  const list = Array.isArray(users) ? users : [];
  const matches = list.filter((u: any) => String(u?.name ?? "").trim().toLowerCase() === target);
  if (matches.length === 0) return { id: null, ambiguous: false };
  if (matches.length > 1) return { id: null, ambiguous: true };
  return { id: String(matches[0].id), ambiguous: false };
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function normalizeDateToken(token: string): string | null {
  const t = token.trim();
  // ISO
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const v = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidISODate(v) ? v : null;
  }
  // "15 Nov" or "15 November"
  const dm = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})$/);
  if (dm) {
    const day = dm[1].padStart(2, "0");
    const monKey = dm[2].slice(0, 3).toLowerCase();
    const mon = MONTHS[monKey];
    if (mon) {
      const year = new Date().getFullYear();
      const v = `${year}-${mon}-${day}`;
      return isValidISODate(v) ? v : null;
    }
  }
  // "Nov 15"
  const md = t.match(/^([A-Za-z]{3,})\s+(\d{1,2})$/);
  if (md) {
    const monKey = md[1].slice(0, 3).toLowerCase();
    const mon = MONTHS[monKey];
    if (mon) {
      const day = md[2].padStart(2, "0");
      const year = new Date().getFullYear();
      const v = `${year}-${mon}-${day}`;
      return isValidISODate(v) ? v : null;
    }
  }
  return null;
}

function extractTrailingDate(sentence: string): string | null {
  // Try ISO anywhere as trailing-ish
  const isoMatch = sentence.match(/(\d{4}-\d{2}-\d{2})\s*$/);
  if (isoMatch) {
    const v = normalizeDateToken(isoMatch[1]);
    if (v) return v;
  }
  const dmMatch = sentence.match(/(\d{1,2}\s+[A-Za-z]{3,})\s*$/);
  if (dmMatch) {
    const v = normalizeDateToken(dmMatch[1]);
    if (v) return v;
  }
  const mdMatch = sentence.match(/([A-Za-z]{3,}\s+\d{1,2})\s*$/);
  if (mdMatch) {
    const v = normalizeDateToken(mdMatch[1]);
    if (v) return v;
  }
  // fallback: search whole sentence
  const isoAny = sentence.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoAny) {
    const v = normalizeDateToken(isoAny[1]);
    if (v) return v;
  }
  const dmAny = sentence.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)/i);
  if (dmAny) {
    const v = normalizeDateToken(dmAny[1]);
    if (v) return v;
  }
  return null;
}

export function deriveFallbackMinutes(notes: string): MinutesPayload {
  const text = String(notes ?? "");
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const keywords = ["will", "agreed", "action", "by"];
  const selected = sentences.filter((s) => {
    const low = s.toLowerCase();
    return keywords.some((k) => low.includes(k));
  });

  const decisions = selected.length > 0 ? selected : sentences.slice(0, 3);

  const minutes_md = decisions.length
    ? decisions.map((s) => `- ${s}`).join("\n")
    : text.trim();

  const proposed_actions: MinutesProposedAction[] = [];
  for (const s of decisions) {
    const due = extractTrailingDate(s);
    if (due) {
      const title = s.length > 160 ? s.slice(0, 160) : s;
      proposed_actions.push({ title, owner_name: "", due_date: due });
    }
  }

  // ensure at least? If none dated, maybe still empty array (0-12 allowed)
  return { minutes_md, decisions, proposed_actions };
}

// Pure guard for signing: minutes must be non-empty.
export function canSignMinutesWithMinutes(minutesMd: unknown): boolean {
  return typeof minutesMd === "string" && minutesMd.trim().length > 0;
}
export const canSign = canSignMinutesWithMinutes;
export const canSignMinutes = canSignMinutesWithMinutes;
export const hasMinutes = canSignMinutesWithMinutes;
export const hasNonEmptyMinutes = canSignMinutesWithMinutes;
export const minutesNonEmpty = canSignMinutesWithMinutes;
export const guardSign = canSignMinutesWithMinutes;
export const signGuard = canSignMinutesWithMinutes;
export const isSignable = canSignMinutesWithMinutes;
