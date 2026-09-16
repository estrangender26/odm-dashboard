/**
 * Attribution for Operator-Driven Maintenance inspection mutations.
 *
 * Why this exists: on 2026-09-16 production `public.mw_inspections` dropped from
 * 16,543 rows to 2,372 and nothing anywhere recorded who or what performed the
 * deletion. This module is the narrow fix: one small helper that writes an
 * attributable audit row for every ODM write path.
 *
 * Rules:
 *   - the audit row is written by the CALLER inside the same transaction as the
 *     mutation, so the two commit or roll back together. A destructive operation
 *     that cannot be recorded cannot commit.
 *   - no secrets and no authentication material are stored: no cookies, no
 *     tokens, no email addresses, no IP addresses. Only `users.id` and
 *     `users.role` identify an authenticated actor; an unauthenticated caller is
 *     recorded as actorId = null / actorRole = "anonymous".
 */
import { randomUUID } from "node:crypto";
import type { InsertMwInspectionAuditRow } from "@db/schema";
import { mwInspectionAudit } from "@db/schema";

/** Every audited ODM write path. Kept closed so a new write path must be classified. */
export const MwAuditOperation = {
  resetAll: "reset_all",
  deleteInspection: "delete_inspection",
  updateInspection: "update_inspection",
  importExcel: "import_excel",
} as const;

export type MwAuditOperation =
  (typeof MwAuditOperation)[keyof typeof MwAuditOperation];

/**
 * Narrow structural view of the Drizzle client: the real client and a
 * transaction handle both satisfy it, and a test double does not have to
 * reimplement the whole query builder.
 */
export interface MwAuditExecutor {
  insert: (table: typeof mwInspectionAudit) => {
    values: (row: InsertMwInspectionAuditRow) => Promise<unknown> | unknown;
  };
}

/** Minimal actor shape; satisfied by `ctx.user` and by `undefined` (anonymous). */
export interface MwAuditActor {
  id: number;
  role: string;
}

export interface MwAuditEntry {
  operation: MwAuditOperation;
  actor?: MwAuditActor | null;
  resource: string;
  affectedCount: number;
  detail?: Record<string, unknown>;
  correlationId?: string;
}

export const ANONYMOUS_ACTOR_ROLE = "anonymous";

/** Correlation id returned to the caller so a user-visible action can be traced to its audit row. */
export function newMwCorrelationId(): string {
  return randomUUID();
}

/**
 * Records one attributable ODM mutation. Throws if the audit row cannot be
 * written, which — because callers pass the mutation's own transaction — also
 * aborts the mutation.
 */
export async function recordMwInspectionAudit(
  executor: MwAuditExecutor,
  entry: MwAuditEntry,
): Promise<string> {
  const correlationId = entry.correlationId ?? newMwCorrelationId();
  const actorId = entry.actor?.id ?? null;
  const actorRole = entry.actor?.role ?? ANONYMOUS_ACTOR_ROLE;

  await executor.insert(mwInspectionAudit).values({
    operation: entry.operation,
    actorId,
    actorRole,
    resource: entry.resource,
    affectedCount: entry.affectedCount,
    correlationId,
    detail: entry.detail ?? {},
  });

  // Structured, secret-free mirror into the application log so the audit is
  // also visible in Render logs without a database query.
  console.log(
    JSON.stringify({
      tag: "mw_inspection_audit",
      operation: entry.operation,
      actorId,
      actorRole,
      resource: entry.resource,
      affectedCount: entry.affectedCount,
      correlationId,
    }),
  );

  return correlationId;
}
