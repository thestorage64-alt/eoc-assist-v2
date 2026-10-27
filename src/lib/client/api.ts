/**
 * Typed fetch helpers for client components.
 *
 * Thin wrappers over /api/* that parse JSON, turn non-2xx responses into a
 * typed `ApiError`, and hand back the route's payload with contract types.
 * Server components never import this — they read data with the module
 * functions straight from `src/lib`.
 */
import type {
  ActionItem,
  Circular,
  CircularDetail,
  Classification,
  ClassificationRecord,
  Meeting,
} from "@/lib/contracts";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const NETWORK_MESSAGE = "Network problem — check your connection and try again.";

/**
 * Server errors arrive as machine codes (`ai_failed`, `notes_too_short`) or bare
 * words (`Forbidden`). Those are not sentences a faculty member should read, so
 * every catch in the UI goes through this.
 */
const FRIENDLY: Record<string, string> = {
  ai_failed: "The AI couldn't draft this. Try again, or record it by hand.",
  ai_timeout: "The AI took too long. Try again, or record it by hand.",
  ai_not_configured: "AI isn't configured here. Record it by hand instead.",
  ai_invalid_output: "The AI returned something unusable. Try again, or record it by hand.",
  notes_too_short: "Add at least 40 characters of meeting notes first.",
  notes_missing: "Add meeting notes before drafting minutes.",
  illegal_transition: "That isn't the next stage for this circular.",
  gate_not_met: "A human decision is required before this can move forward.",
  network: NETWORK_MESSAGE,
  Forbidden: "You don't have permission to do that.",
  Unauthorized: "Your session has expired — sign in again.",
  "Not found": "That record isn't available to you.",
};

export function humanError(e: unknown, fallback = "Something went wrong — try again."): string {
  if (e instanceof ApiError) {
    return FRIENDLY[e.code ?? ""] ?? FRIENDLY[e.message] ?? e.message;
  }
  return fallback;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError(0, NETWORK_MESSAGE, "network");
  }

  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;

  if (!res.ok) {
    const message =
      (data && typeof data.error === "string" && data.error) ||
      `Request failed (${res.status}).`;
    throw new ApiError(res.status, message, data?.code);
  }
  if (data === null) {
    throw new ApiError(res.status, "The server returned an unreadable response.", "bad_json");
  }
  return data;
}

async function doGet<T>(url: string): Promise<T> {
  return request<T>("GET", url);
}
async function doPost<T>(url: string, body?: unknown): Promise<T> {
  return request<T>("POST", url, body);
}
async function doPatch<T>(url: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", url, body);
}

/* ------------------------------------------------------------ responses -- */
/* Mirrors of the route payloads; each route returns these shapes exactly. */

export interface ClassifyResult {
  ok: boolean;
  suggestion: Classification;
}

export interface ConfirmResult {
  ok: boolean;
  classification: ClassificationRecord;
}

export interface TransitionResult {
  ok: boolean;
  circular: Circular;
}

export interface MeetingResult {
  ok: boolean;
  meeting: Meeting;
}

export interface MinutesResult {
  ok: boolean;
  minutesMd: string;
  decisions: string[];
  proposedActions: { title: string; ownerName: string; dueDate: string | null }[];
}

export interface SignResult {
  ok: boolean;
  actions: ActionItem[];
}

export interface ActionResult {
  ok: boolean;
  action: ActionItem;
}

export interface NewCircularResult {
  ok: boolean;
  circular: Circular;
}

/* ------------------------------------------------------------ payloads --- */

export interface CreateMeetingInput {
  /** Unix ms. Omit for "now". */
  heldAt?: number;
  /** Active user ids (validated server-side). */
  attendees?: string[];
  /** Notes must be ≥ 40 chars before minutes can be generated. */
  notes?: string;
}

export interface AddActionInput {
  title: string;
  ownerId?: string | null;
  /** Unix ms. */
  dueAt?: number | null;
}

export interface NewCircularInput {
  title: string;
  body: string;
  source: string;
  dueAt: number | null;
  cellId: string | null;
  confidential: boolean;
}

/* -------------------------------------------------------------- helpers -- */

export const api = {
  /** POST /api/circulars/:id/classify — ask the AI annotator for a suggestion. */
  classify(circularId: string): Promise<ClassifyResult> {
    return doPost<ClassifyResult>(`/api/circulars/${circularId}/classify`);
  },

  /** POST /api/circulars/:id/confirm — record the human decision. */
  confirm(
    circularId: string,
    verdict: "confirmed" | "corrected",
    classification: Classification
  ): Promise<ConfirmResult> {
    return doPost<ConfirmResult>(`/api/circulars/${circularId}/confirm`, {
      verdict,
      classification,
    });
  },

  /** POST /api/circulars/:id/transition — advance one lifecycle stage. */
  transition(circularId: string, to: string): Promise<TransitionResult> {
    return doPost<TransitionResult>(`/api/circulars/${circularId}/transition`, { to });
  },

  /** POST /api/circulars/:id/meetings — schedule or log a meeting. */
  createMeeting(circularId: string, input: CreateMeetingInput): Promise<MeetingResult> {
    return doPost<MeetingResult>(`/api/circulars/${circularId}/meetings`, {
      held_at: input.heldAt ?? null,
      attendees: input.attendees ?? [],
      notes: input.notes ?? "",
    });
  },

  /**
   * POST /api/meetings/:id/minutes — generate minutes + proposed actions.
   * `manual: true` records them without the model, for when the provider fails.
   */
  generateMinutes(meetingId: string, notes: string, manual = false): Promise<MinutesResult> {
    return doPost<MinutesResult>(`/api/meetings/${meetingId}/minutes`, manual ? { notes, manual: true } : { notes });
  },

  /** POST /api/meetings/:id/sign — sign off minutes; proposed actions become actions. */
  signMinutes(meetingId: string): Promise<SignResult> {
    return doPost<SignResult>(`/api/meetings/${meetingId}/sign`);
  },

  /** POST /api/circulars/:id/actions — add a standalone action item. */
  addAction(circularId: string, input: AddActionInput): Promise<ActionResult> {
    return doPost<ActionResult>(`/api/circulars/${circularId}/actions`, {
      title: input.title,
      owner_id: input.ownerId ?? null,
      due_at: input.dueAt ?? null,
    });
  },

  /** PATCH /api/actions/:id — set open / done status. */
  updateAction(actionId: string, status: "open" | "done"): Promise<ActionResult> {
    return doPatch<ActionResult>(`/api/actions/${actionId}`, { status });
  },

  /** POST /api/circulars — register a new circular. */
  createCircular(input: NewCircularInput): Promise<NewCircularResult> {
    return doPost<NewCircularResult>("/api/circulars", {
      title: input.title,
      body: input.body,
      source: input.source,
      due_at: input.dueAt,
      cell_id: input.cellId,
      confidential: input.confidential,
    });
  },

  /** GET /api/circulars/:id — full detail (client-side use only). */
  getCircularDetail(circularId: string) {
    return doGet<{ ok: boolean; circular: CircularDetail }>(`/api/circulars/${circularId}`);
  },
};

export { doGet, doPost, doPatch };
