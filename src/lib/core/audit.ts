
import { randomUUID } from "node:crypto";
import { query } from "@/lib/core/db";

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  cellId?: string | null;
  detail?: Record<string, unknown>;
}

type AuditArgs =
  | [AuditInput]
  | [string | null, string, (string | null)?, (string | null)?, (string | null)?, Record<string, unknown>?];

export async function audit(...args: AuditArgs): Promise<void> {
  let input: AuditInput;
  if (args.length === 1 && typeof args[0] === "object" && args[0] !== null && "action" in (args[0] as any)) {
    input = args[0] as AuditInput;
  } else {
    const [actorId, action, entityType, entityId, cellId, detail] = args as any;
    input = { actorId, action, entityType, entityId, cellId, detail };
  }
  const id = randomUUID();
  const at = Date.now();
  await query(
    "INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, cell_id, detail, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      input.actorId ?? null,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.cellId ?? null,
      JSON.stringify(input.detail ?? {}),
      at,
    ]
  );
}

export const logAudit = audit;
export const recordAudit = audit;
export const appendAudit = audit;
