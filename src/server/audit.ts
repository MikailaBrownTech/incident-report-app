import type { ScopedDb } from "@/server/db/tenant";

export type AuditAction =
  | "workspace.created"
  | "member.role_changed"
  | "member.removed"
  | "invite.created"
  | "invite.resent"
  | "invite.revoked"
  | "invite.accepted"
  | "incident.created"
  | "incident.status_changed"
  | "incident.severity_changed"
  | "incident.role_changed"
  | "incident.deleted"
  | "incident.note_deleted";

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  targetType: "workspace" | "member" | "invite" | "incident";
  targetId: string;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Append an audit row. Pass the transaction client when the audited change runs in a
 * transaction so the row commits (or rolls back) with it.
 */
export async function writeAudit(
  db: Pick<ScopedDb, "auditLog">,
  workspaceId: string,
  entry: AuditEntry,
): Promise<void> {
  await db.auditLog.create({
    data: {
      workspaceId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
    },
  });
}
