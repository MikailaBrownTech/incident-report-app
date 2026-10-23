import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Seeded recurrence links, shared by the demo seed and `seed:mine`. Writes what linking in the app writes: the pointer, a
 * timeline entry on both incidents and an audit row, but placed in time just after the later incident started.
 */
export interface SeedIncidentRef {
  id: string;
  number: number;
  title: string;
  startedAt: Date;
  revenantOfId: string | null;
}

/** Links `incident` to `root` unless it already points somewhere. Returns whether it created the link. */
export async function ensureSeedRevenantLink(
  db: PrismaClient,
  input: { workspaceId: string; actorId: string; incident: SeedIncidentRef; root: SeedIncidentRef; now: Date },
): Promise<boolean> {
  const { workspaceId, actorId, incident, root, now } = input;
  if (incident.revenantOfId || incident.id === root.id) return false;
  if (root.startedAt.getTime() >= incident.startedAt.getTime())
    throw new Error(`seed: ${root.title} is not earlier than ${incident.title}`);

  const at = new Date(Math.min(incident.startedAt.getTime() + 20 * 60_000, now.getTime()));
  await db.$transaction(async (tx) => {
    await tx.incident.update({ where: { id: incident.id }, data: { revenantOfId: root.id } });
    const event = (incidentId: string, payload: Record<string, unknown>) =>
      tx.event.create({
        data: {
          workspaceId,
          incidentId,
          type: "REVENANT_LINKED",
          source: "USER",
          actorId,
          payload: payload as never,
          occurredAt: at,
          createdAt: at,
          updatedAt: at,
        },
      });
    await event(incident.id, { role: "revenant", rootNumber: root.number, rootTitle: root.title });
    await event(root.id, { role: "root", revenantNumber: incident.number, revenantTitle: incident.title });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorId,
        action: "incident.revenant_linked",
        targetType: "incident",
        targetId: incident.id,
        metadata: { number: incident.number, rootNumber: root.number, seeded: true },
        createdAt: at,
      },
    });
  });
  return true;
}
