import type { IncidentStatus, Prisma } from "@/generated/prisma/client";
import type { ScopedDb } from "@/server/db/tenant";
import { numberFromQuery, type ListParams, type SortKey } from "./list-params";

export interface IncidentRow {
  id: string;
  number: number;
  title: string;
  severity: number;
  status: IncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  services: { id: string; name: string }[];
  commander: { name: string; email: string; image: string | null } | null;
}

const ORDER_FIELD: Record<SortKey, "startedAt" | "severity" | "status" | "number"> = {
  started: "startedAt",
  severity: "severity",
  status: "status",
  number: "number",
};

/** Prisma's `contains` passes % and _ through as LIKE wildcards; escape them so the search is literal. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
const nextDayStart = (day: string) => new Date(dayStart(day).getTime() + 86_400_000);

export function buildWhere(p: ListParams): Prisma.IncidentWhereInput {
  const number = numberFromQuery(p.q);
  const and: Prisma.IncidentWhereInput[] = [];

  if (p.status.length > 0) and.push({ status: { in: p.status } });
  else if (p.openOnly) and.push({ status: { not: "RESOLVED" } });

  if (p.severity.length > 0) and.push({ severity: { in: p.severity } });
  if (p.serviceIds.length > 0) and.push({ services: { some: { serviceId: { in: p.serviceIds } } } });
  if (p.from) and.push({ startedAt: { gte: dayStart(p.from) } });
  if (p.to) and.push({ startedAt: { lt: nextDayStart(p.to) } });
  if (p.q) {
    and.push({
      OR: [{ title: { contains: escapeLike(p.q), mode: "insensitive" } }, ...(number !== null ? [{ number }] : [])],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

/**
 * One page of incidents for the workspace. Keyset pagination: the cursor is the last row's id and
 * the order always ends with `id`, so pages are stable even when the sort column has ties.
 */
export async function listIncidents(
  db: ScopedDb,
  params: ListParams,
  pageSize = params.limit,
): Promise<{ items: IncidentRow[]; nextCursor: string | null }> {
  const field = ORDER_FIELD[params.sort];
  const rows = await db.incident.findMany({
    where: buildWhere(params),
    orderBy: [{ [field]: params.dir }, { id: params.dir }],
    take: pageSize + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      number: true,
      title: true,
      severity: true,
      status: true,
      startedAt: true,
      resolvedAt: true,
      services: { select: { service: { select: { id: true, name: true } } }, orderBy: { service: { name: "asc" } } },
      assignments: {
        where: { role: "COMMANDER" },
        select: { member: { select: { user: { select: { name: true, email: true, image: true } } } } },
      },
    },
  });

  const page = rows.slice(0, pageSize);
  return {
    items: page.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      severity: r.severity,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      services: r.services.map((s) => s.service),
      commander: r.assignments[0]?.member.user ?? null,
    })),
    nextCursor: rows.length > pageSize ? page[page.length - 1].id : null,
  };
}

export async function getIncidentByNumber(db: ScopedDb, number: number) {
  const incident = await db.incident.findFirst({
    where: { number },
    include: {
      services: { select: { service: { select: { id: true, name: true, slug: true } } } },
      assignments: {
        select: { role: true, member: { select: { user: { select: { name: true, email: true, image: true } } } } },
      },
    },
  });
  if (!incident) return null;
  const creator = await db.membership.findFirst({
    where: { userId: incident.createdById },
    select: { user: { select: { name: true, email: true } } },
  });
  return { incident, creator: creator?.user ?? null };
}
