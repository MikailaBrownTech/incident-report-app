import { listChains } from "@/features/revenants/recurring";
import { summarize } from "@/features/revenants/candidates";
import type { ChainRow, IncidentSummary } from "@/features/revenants/types";
import type { ScopedDb } from "@/server/db/tenant";

export interface ServiceHistory {
  service: { id: string; name: string; slug: string };
  items: IncidentSummary[];
  nextCursor: string | null;
  /** Recurring issues that touch this service. */
  chains: ChainRow[];
  resolvedCount: number;
  /** Mean time to resolve over its resolved incidents, in milliseconds; null when none are resolved. */
  mttrMs: number | null;
  bySeverity: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** A service's incident history (newest first, paged), its chains, mean time to resolve and counts by severity. */
export async function getServiceHistory(
  db: ScopedDb,
  slug: string,
  opts: { limit: number; cursor: string | null },
  now: Date = new Date(),
): Promise<ServiceHistory | null> {
  const service = await db.service.findFirst({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (!service) return null;
  const where = { services: { some: { serviceId: service.id } } };

  const [rows, resolved, severities, chains] = await Promise.all([
    db.incident.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "asc" }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: { id: true, number: true, title: true, severity: true, status: true, startedAt: true, resolvedAt: true },
    }),
    db.incident.findMany({
      where: { ...where, status: "RESOLVED", resolvedAt: { not: null } },
      select: { startedAt: true, resolvedAt: true },
    }),
    db.incident.groupBy({ by: ["severity"], where, _count: { _all: true } }),
    listChains(
      db,
      {
        service: [service.id],
        minOccurrences: 2,
        hasOpenRituals: false,
        q: "",
        sort: "recent",
        limit: 10,
        cursor: null,
      },
      now,
    ),
  ]);

  const page = rows.slice(0, opts.limit);
  const bySeverity = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const s of severities) bySeverity[s.severity as 1 | 2 | 3 | 4 | 5] = s._count._all;
  const total = resolved.reduce((sum, r) => sum + (r.resolvedAt!.getTime() - r.startedAt.getTime()), 0);
  return {
    service,
    items: page.map(summarize),
    nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null,
    chains: chains.items,
    resolvedCount: resolved.length,
    mttrMs: resolved.length ? Math.round(total / resolved.length) : null,
    bySeverity,
  };
}
