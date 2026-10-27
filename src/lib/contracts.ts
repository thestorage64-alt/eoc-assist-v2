/**
 * The shared contract. FROZEN.
 *
 * Every module imports these types; no module may redefine them. If a shape
 * must change, it changes here first, deliberately — that is the seam that
 * lets three agents work without colliding.
 */

/* --------------------------------------------------------------- roles --- */

export type GlobalRole = "principal" | "chair" | "head" | "member";
export type CellRole = "head" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  designation: string;
  phone: string;
  role: GlobalRole;
  status: "active" | "disabled";
}

export interface Membership {
  cellId: string;
  role: CellRole;
}

/** A signed-in person plus their per-cell roles. Built once per request. */
export interface Actor {
  user: User;
  memberships: Membership[];
}

/* ---------------------------------------------------------------- cells --- */

export interface Cell {
  id: string;
  number: number;
  name: string;
  mandate: string;
  head: { id: string; name: string } | null;
  openCirculars: number;
}

/* ------------------------------------------------------------ lifecycle --- */

export const STATES = [
  "intake",
  "route",
  "convene",
  "pre_meeting",
  "meeting",
  "implement",
  "verify",
  "report",
  "done",
] as const;

export type CircularState = (typeof STATES)[number];

/** The six manual forward edges. `intake→route` and `report→done` are gated. */
export const NEXT_STATE: Partial<Record<CircularState, CircularState>> = {
  route: "convene",
  convene: "pre_meeting",
  pre_meeting: "meeting",
  meeting: "implement",
  implement: "verify",
  verify: "report",
};

export const STATE_LABEL: Record<CircularState, string> = {
  intake: "Intake",
  route: "Routed",
  convene: "Convening",
  pre_meeting: "Pre-meeting",
  meeting: "In meeting",
  implement: "Implementing",
  verify: "Verifying",
  report: "Reporting",
  done: "Done",
};

/**
 * Every legal forward move, including the two gated edges that are deliberately
 * absent from NEXT_STATE. UI code must use this, not NEXT_STATE directly, or the
 * intake and report stages become dead ends with no control rendered.
 */
export function nextState(s: CircularState): CircularState | null {
  return NEXT_STATE[s] ?? (s === "intake" ? "route" : s === "report" ? "done" : null);
}

export function isState(v: unknown): v is CircularState {
  return typeof v === "string" && (STATES as readonly string[]).includes(v);
}

/* --------------------------------------------------------- classification - */

export type Confidence = "high" | "medium" | "low";
export type Verdict = "confirmed" | "corrected";

export interface Classification {
  primaryCell: string;
  relatedCells: string[];
  primarySdg: number;
  relatedSdgs: number[];
  reason: string;
  confidence: Confidence;
  tags: string[];
}

export interface ClassificationRecord {
  suggestion: Classification | null;
  final: Classification | null;
  verdict: Verdict | null;
  decidedBy: string | null;
  decidedAt: number | null;
}

/** Canonical 14 cells. Ids are stable and used in the database. */
export const CELL_SPEC: { id: string; number: number; name: string }[] = [
  { id: "cell_01", number: 1, name: "SC/ST Cell" },
  { id: "cell_02", number: 2, name: "OBC Cell" },
  { id: "cell_03", number: 3, name: "Women's Cell" },
  { id: "cell_04", number: 4, name: "Minority Cell" },
  { id: "cell_05", number: 5, name: "Differently Abled Cell" },
  { id: "cell_06", number: 6, name: "International Students Cell" },
  { id: "cell_07", number: 7, name: "Counselling and Mentoring Cell" },
  { id: "cell_08", number: 8, name: "Gender Sensitization Cell" },
  { id: "cell_09", number: 9, name: "Prevention of Sexual Harassment Cell" },
  { id: "cell_10", number: 10, name: "National Service Scheme Cell" },
  { id: "cell_11", number: 11, name: "Human Studies Cell" },
  { id: "cell_12", number: 12, name: "Population Studies Cell" },
  { id: "cell_13", number: 13, name: "Remedial Coaching Cell" },
  { id: "cell_14", number: 14, name: "Women's Study Cell" },
];

export const SDG_NAMES: Record<number, string> = {
  1: "No Poverty",
  2: "Zero Hunger",
  3: "Good Health and Well-being",
  4: "Quality Education",
  5: "Gender Equality",
  6: "Clean Water and Sanitation",
  7: "Affordable and Clean Energy",
  8: "Decent Work and Economic Growth",
  9: "Industry, Innovation and Infrastructure",
  10: "Reduced Inequalities",
  11: "Sustainable Cities and Communities",
  12: "Responsible Consumption and Production",
  13: "Climate Action",
  14: "Life Below Water",
  15: "Life on Land",
  16: "Peace, Justice and Strong Institutions",
  17: "Partnerships for the Goals",
};

/* --------------------------------------------------------------- records -- */

export interface Circular {
  id: string;
  ref: string;
  title: string;
  body: string;
  source: string;
  receivedAt: number;
  dueAt: number | null;
  state: CircularState;
  cellId: string | null;
  assignedTo: string | null;
  createdBy: string;
  confidential: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CircularDetail extends Circular {
  classification: ClassificationRecord;
  meetings: Meeting[];
  actions: ActionItem[];
  documents: DocumentRecord[];
}

export interface ProposedAction {
  title: string;
  ownerName: string;
  dueDate: string | null;
}

export interface Meeting {
  id: string;
  circularId: string;
  heldAt: number;
  attendees: string[];
  notes: string;
  status: "scheduled" | "held" | "signed";
  minutesMd: string | null;
  decisions: string[];
  /** Generated with the minutes, persisted until signing turns them into actions. */
  proposedActions: ProposedAction[];
  signedBy: string | null;
  signedAt: number | null;
  createdAt: number;
}

export interface ActionItem {
  id: string;
  circularId: string;
  meetingId: string | null;
  title: string;
  ownerId: string | null;
  dueAt: number | null;
  status: "open" | "done" | "cancelled";
  completedAt: number | null;
  createdAt: number;
}

export interface DocumentRecord {
  id: string;
  circularId: string;
  kind: string;
  version: number;
  contentMd: string;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: number | null;
  createdAt: number;
}

export interface AuditEvent {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  cellId: string | null;
  detail: Record<string, unknown>;
  at: number;
}

/* -------------------------------------------------------------- responses - */

export interface ApiError {
  error: string;
  code?: string;
}

export interface SessionUser {
  user: User;
  memberships: Membership[];
}

export interface DashboardSummary {
  needsAttention: { circularId: string; title: string; reason: string; dueAt: number | null }[];
  counts: { byState: Record<string, number>; open: number; overdue: number };
  cells: { cellId: string; name: string; open: number; overdue: number }[];
}

export interface ReportSummary {
  from: number;
  to: number;
  received: number;
  routed: number;
  completed: number;
  meetings: number;
  actionsOpen: number;
  actionsOverdue: number;
  sdgCoverage: { sdg: number; count: number }[];
  perCell: { cellId: string; name: string; received: number; completed: number }[];
}
