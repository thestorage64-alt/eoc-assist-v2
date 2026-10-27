import { NEXT_STATE, type CircularState, isState } from "@/lib/contracts";

export interface TransitionContext {
  hasFinal?: boolean;
  final?: unknown;
  classification?: { final?: unknown } | null;
  hasApprovedReport?: boolean;
  approvedReport?: boolean;
  reportApproved?: boolean;
}

export interface TransitionResult {
  ok: boolean;
  reason: string | null;
}

function hasFinal(ctx?: TransitionContext): boolean {
  if (!ctx) return false;
  if (typeof ctx.hasFinal === "boolean") return ctx.hasFinal;
  if (ctx.final !== undefined) return ctx.final !== null && ctx.final !== undefined;
  if (ctx.classification && typeof ctx.classification === "object") {
    return (ctx.classification as any).final !== null && (ctx.classification as any).final !== undefined;
  }
  return false;
}

function hasApprovedReport(ctx?: TransitionContext): boolean {
  if (!ctx) return false;
  if (typeof ctx.hasApprovedReport === "boolean") return ctx.hasApprovedReport;
  if (typeof ctx.approvedReport === "boolean") return ctx.approvedReport;
  if (typeof ctx.reportApproved === "boolean") return ctx.reportApproved;
  return false;
}

export const LEGAL_EDGES: Record<string, string> = {
  "intake->route": "route",
  ...Object.fromEntries(Object.entries(NEXT_STATE).map(([k, v]) => [`${k}->${v}`, v])),
  "report->done": "done",
};

export function isLegalEdge(from: string, to: string): boolean {
  if (from === "intake" && to === "route") return true;
  if (from === "report" && to === "done") return true;
  return NEXT_STATE[from as CircularState] === to;
}

export function canTransition(
  from: string,
  to: string,
  ctx?: TransitionContext
): TransitionResult {
  if (!isState(from) || !isState(to)) {
    return { ok: false, reason: "unknown state" };
  }
  if (!isLegalEdge(from, to)) {
    return { ok: false, reason: `illegal transition ${from} -> ${to}` };
  }
  if (from === "intake" && to === "route") {
    if (!hasFinal(ctx)) {
      return { ok: false, reason: "intake->route requires a final classification" };
    }
  }
  if (from === "report" && to === "done") {
    if (!hasApprovedReport(ctx)) {
      return { ok: false, reason: "report->done requires an approved report document" };
    }
  }
  return { ok: true, reason: null };
}

export function validateTransition(
  from: string,
  to: string,
  ctx?: TransitionContext
): TransitionResult {
  return canTransition(from, to, ctx);
}

export function checkTransition(
  from: string,
  to: string,
  ctx?: TransitionContext
): TransitionResult {
  return canTransition(from, to, ctx);
}

export function isTransitionAllowed(
  from: string,
  to: string,
  ctx?: TransitionContext
): boolean {
  return canTransition(from, to, ctx).ok;
}

export function transitionAllowed(
  from: string,
  to: string,
  ctx?: TransitionContext
): boolean {
  return canTransition(from, to, ctx).ok;
}

export function isTransitionLegal(
  from: string,
  to: string,
  ctx?: TransitionContext
): boolean {
  return canTransition(from, to, ctx).ok;
}