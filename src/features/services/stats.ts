import { listChains } from "@/features/revenants/recurring";
import type { ScopedDb } from "@/server/db/tenant";

export interface ServiceStats {
  /** Incidents that started in the last 90 days. */
  incidents90: number;
  /** Recurring issues (chains) with an occurrence on this service. */
  chains: number;
  /** Open or in-progress action items on this service's incidents. */
  openRituals: number;
}

const DAY = 86_400_000;

/** Numbers for the Services page columns. Soft-deleted incidents are excluded everywhere. Kept apart from `listServices`, which every page loads. */
export async function getServiceStats(db: ScopedDb, now: Date = new Date()): Promise<Map<string, ServiceStats>> {
  const since = new Date(now.getTime() - 90 * DAY);
  const [recent, openItems] = await Promise.all([
    db.incidentService.groupBy({
      by: ["serviceId"],
      where: { incident: { deletedAt: null, startedAt: { gte: since } } },
      _count: { _all: true },
    }),
    db.actionItem.groupBy({
      by: ["incidentId"],
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, incident: { deletedAt: null } },
      _count: { _all: true },
    }),
  ]);

  const stats = new Map<string, ServiceStats>();
  const entry = (id: string) => {
    const s = stats.get(id) ?? { incidents90: 0, chains: 0, openRituals: 0 };
    stats.set(id, s);
    return s;
  };
  for (const r of recent) entry(r.serviceId).incidents90 = r._count._all;

  if (openItems.length > 0) {
    const links = await db.incidentService.findMany({
      where: { incidentId: { in: openItems.map((o) => o.incidentId) }, incident: { deletedAt: null } },
      select: { incidentId: true, serviceId: true },
    });
    const perIncident = new Map(openItems.map((o) => [o.incidentId, o._count._all]));
    for (const l of links) entry(l.serviceId).openRituals += perIncident.get(l.incidentId) ?? 0;
  }

  // chains touching each service (a few pages is plenty: a workspace rarely has more than a hundred)
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const result = await listChains(
      db,
      { service: [], minOccurrences: 2, hasOpenRituals: false, q: "", sort: "recent", limit: 100, cursor },
      now,
    );
    for (const row of result.items) for (const s of row.services) entry(s.id).chains += 1;
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return stats;
}
