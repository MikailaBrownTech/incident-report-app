import { utcDay } from "@/features/action-items/state";
import type { ScopedDb } from "@/server/db/tenant";
import { bucketIncidents, rangeStart, type Bucket, type Range } from "./range";

export interface OpenIncident {
  id: string;
  number: number;
  title: string;
  severity: number;
  startedAt: string;
}

export interface DashboardData {
  range: Range;
  inRange: number;
  /** Incidents (any age) that exist but fall before the window, so an empty window can say so. */
  olderCount: number;
  totalAll: number;
  openNow: number;
  /** Mean minutes from start to resolution for incidents in the window that were resolved; null with none. */
  mttrMinutes: number | null;
  overdueItems: number;
  recurring: number;
  bySeverity: Record<1 | 2 | 3 | 4 | 5, number>;
  buckets: Bucket[];
  needsAttention: OpenIncident[];
}

const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const OPEN = ["INVESTIGATING", "IDENTIFIED", "MITIGATING"] as const;

/**
 * Everything on the dashboard for one workspace. `db` is the scoped client, so workspaceId and soft-deleted incidents
 * are handled for us; the window filters on `startedAt` (when it began, not when it was entered).
 */
export async function getDashboard(db: ScopedDb, range: Range, now: Date = new Date()): Promise<DashboardData> {
  const from = rangeStart(range, now);
  const window = from ? { startedAt: { gte: from, lte: now } } : {};
  const [rows, totalAll, openNow, open, overdueItems] = await Promise.all([
    db.incident.findMany({
      where: window,
      select: { severity: true, startedAt: true, resolvedAt: true, revenantOfId: true },
    }),
    db.incident.count(),
    db.incident.count({ where: { status: { in: [...OPEN] } } }),
    db.incident.findMany({
      where: { status: { in: [...OPEN] } },
      orderBy: [{ severity: "desc" }, { startedAt: "asc" }, { id: "asc" }],
      take: 5,
      select: { id: true, number: true, title: true, severity: true, startedAt: true },
    }),
    db.actionItem.count({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS"] },
        dueDate: { lt: dayToDate(utcDay(now)) },
        incident: { deletedAt: null },
      },
    }),
  ]);

  const bySeverity = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const durations: number[] = [];
  for (const r of rows) {
    if (r.severity >= 1 && r.severity <= 5) bySeverity[r.severity as 1 | 2 | 3 | 4 | 5] += 1;
    if (r.resolvedAt) durations.push(r.resolvedAt.getTime() - r.startedAt.getTime());
  }
  return {
    range,
    inRange: rows.length,
    olderCount: totalAll - rows.length,
    totalAll,
    openNow,
    mttrMinutes: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length / 60_000 : null,
    overdueItems,
    recurring: rows.filter((r) => r.revenantOfId !== null).length,
    bySeverity,
    buckets: bucketIncidents(
      rows.map((r) => r.startedAt),
      range,
      now,
    ),
    needsAttention: open.map((i) => ({ ...i, startedAt: i.startedAt.toISOString() })),
  };
}
