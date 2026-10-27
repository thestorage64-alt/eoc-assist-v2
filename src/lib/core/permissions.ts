import type { Actor } from "@/lib/contracts";
import type { CellRole } from "@/lib/contracts";

export function cellRoleOf(actor: Actor, cellId: string | null): CellRole | null {
  if (!cellId) return null;
  const m = actor.memberships.find((m) => m.cellId === cellId);
  return m ? m.role : null;
}

export function isChair(actor: Actor): boolean {
  return actor.user.role === "chair";
}

export function isPrincipal(actor: Actor): boolean {
  return actor.user.role === "principal";
}

export function canReadCircular(actor: Actor, c: { cellId: string | null; confidential: boolean }): boolean {
  if (c.confidential) {
    if (isPrincipal(actor) || isChair(actor)) return true;
    if (c.cellId && cellRoleOf(actor, c.cellId) !== null) return true;
    return false;
  }
  return true;
}

export function canCreateCircular(actor: Actor): boolean {
  if (isPrincipal(actor)) return false;
  return true;
}

export function canEditCircular(actor: Actor, c: { cellId: string | null }): boolean {
  if (isPrincipal(actor)) return false;
  if (isChair(actor)) return true;
  if (c.cellId && cellRoleOf(actor, c.cellId) === "head") return true;
  return false;
}

export function canConfirmClassification(actor: Actor, cellId: string | null): boolean {
  if (isPrincipal(actor)) return false;
  if (isChair(actor)) return true;
  if (cellId && cellRoleOf(actor, cellId) === "head") return true;
  return false;
}

export function canAdvance(actor: Actor, c: { cellId: string | null }): boolean {
  return canEditCircular(actor, c);
}

export function canSignMinutes(actor: Actor, cellId: string | null): boolean {
  if (isPrincipal(actor)) return false;
  if (isChair(actor)) return true;
  if (cellId && cellRoleOf(actor, cellId) === "head") return true;
  return false;
}

export function canCloseAction(actor: Actor, ownerId: string | null, cellId: string | null): boolean {
  if (isPrincipal(actor)) return false;
  if (isChair(actor)) return true;
  if (ownerId && ownerId === actor.user.id) return true;
  if (cellId && cellRoleOf(actor, cellId) === "head") return true;
  return false;
}

export function canExport(actor: Actor): boolean {
  return true;
}

export function canReadAudit(actor: Actor, cellId: string | null): boolean {
  if (isPrincipal(actor) || isChair(actor)) return true;
  if (cellId && cellRoleOf(actor, cellId) === "head") return true;
  return false;
}
