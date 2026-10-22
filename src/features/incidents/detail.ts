import type { ScopedDb } from "@/server/db/tenant";
import { ROLE_KEYS, type IncidentDetailView, type PersonView, type RoleKey, type StatusKey } from "./schema";

/** The incident with everything the detail page and PATCH/status/roles responses need, or null if missing/deleted. */
export async function getIncidentDetail(db: ScopedDb, number: number): Promise<IncidentDetailView | null> {
  const incident = await db.incident.findFirst({
    where: { number },
    include: {
      services: { select: { service: { select: { id: true, name: true } } }, orderBy: { service: { name: "asc" } } },
      assignments: {
        select: {
          role: true,
          userId: true,
          member: { select: { user: { select: { name: true, email: true, image: true } } } },
        },
      },
    },
  });
  if (!incident) return null;

  // The creator may have left the workspace since; then we simply don't show them.
  const creator = await db.membership.findFirst({
    where: { userId: incident.createdById },
    select: { user: { select: { name: true, email: true } } },
  });

  const roles = Object.fromEntries(ROLE_KEYS.map((r) => [r, null])) as Record<RoleKey, PersonView | null>;
  for (const a of incident.assignments) {
    roles[a.role] = { userId: a.userId, ...a.member.user };
  }

  return {
    id: incident.id,
    number: incident.number,
    title: incident.title,
    summary: incident.summary,
    severity: incident.severity,
    status: incident.status as StatusKey,
    startedAt: incident.startedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    createdAt: incident.createdAt.toISOString(),
    createdBy: creator?.user ?? null,
    services: incident.services.map((s) => s.service),
    roles,
  };
}
