import { getActionItemState, utcDay } from "@/features/action-items/state";
import { loadRetroRules } from "@/features/postmortems/service";
import { getPostmortemStatus } from "@/features/postmortems/status";
import type { ScopedDb } from "@/server/db/tenant";
import { findSuspects } from "./recurring";
import { summarize } from "./candidates";
import type { IncidentSummary } from "./types";

export interface RecurrenceStats {
  incidentCount: number;
  revenantCount: number;
  revenantRate: number;
  activeChains: number;
  topChains: { root: IncidentSummary; occurrencesInPeriod: number; totalOccurrences: number }[];
  openRitualsInChains: number;
}

/** Recurrence numbers for a period, for the dashboard. Soft-deleted incidents are excluded everywhere. */
export async function getRecurrenceStats(db: ScopedDb, range: { from: Date; to: Date }): Promise<RecurrenceStats> {
  const inPeriod = { startedAt: { gte: range.from, lt: range.to } };
  const [period, allRevenants] = await Promise.all([
    db.incident.findMany({
      where: inPeriod,
      select: { id: true, revenantOfId: true },
    }),
    db.incident.findMany({ where: { revenantOfId: { not: null } }, select: { id: true, revenantOfId: true } }),
  ]);
  const incidentCount = period.length;
  const revenantCount = period.filter((i) => i.revenantOfId !== null).length;

  // chains: root id -> every member id (the root plus its revenants)
  const members = new Map<string, Set<string>>();
  for (const r of allRevenants) {
    const root = r.revenantOfId as string;
    members.set(root, (members.get(root) ?? new Set([root])).add(r.id));
  }
  const rootOf = new Map<string, string>();
  for (const [root, set] of members) for (const id of set) rootOf.set(id, root);

  const perChain = new Map<string, number>();
  for (const i of period) {
    const root = rootOf.get(i.id);
    if (root) perChain.set(root, (perChain.get(root) ?? 0) + 1);
  }

  const topIds = [...perChain].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
  const roots = await db.incident.findMany({
    where: { id: { in: topIds.map(([id]) => id) } },
    select: { id: true, number: true, title: true, severity: true, status: true, startedAt: true, resolvedAt: true },
  });
  const rootById = new Map(roots.map((r) => [r.id, r]));

  const chainIncidentIds = [...rootOf.keys()];
  const openRitualsInChains = chainIncidentIds.length
    ? await db.actionItem.count({
        where: {
          incidentId: { in: chainIncidentIds },
          status: { in: ["OPEN", "IN_PROGRESS"] },
          incident: { deletedAt: null },
        },
      })
    : 0;

  return {
    incidentCount,
    revenantCount,
    revenantRate: incidentCount === 0 ? 0 : revenantCount / incidentCount,
    activeChains: perChain.size,
    topChains: topIds.flatMap(([id, n]) => {
      const root = rootById.get(id);
      return root ? [{ root: summarize(root), occurrencesInPeriod: n, totalOccurrences: members.get(id)!.size }] : [];
    }),
    openRitualsInChains,
  };
}

export interface AccountabilitySummary {
  overdueActionItems: number;
  dueSoonActionItems: number;
  overduePostmortems: number;
  unlinkedStrongSuspects: number;
}

/** What needs attention across action items and postmortems, for the dashboard. */
export async function getAccountabilitySummary(db: ScopedDb, today: Date = new Date()): Promise<AccountabilitySummary> {
  const [items, rules, resolved, suspects] = await Promise.all([
    db.actionItem.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, incident: { deletedAt: null } },
      select: { status: true, dueDate: true },
    }),
    loadRetroRules(db),
    db.incident.findMany({
      where: { status: "RESOLVED" },
      select: { severity: true, status: true, resolvedAt: true, postmortem: { select: { status: true } } },
    }),
    findSuspects(db, Number.MAX_SAFE_INTEGER, today),
  ]);
  const day = utcDay(today);
  const states = items.map((i) => getActionItemState({ status: i.status, dueDate: i.dueDate }, day).state);
  return {
    overdueActionItems: states.filter((s) => s === "OVERDUE").length,
    dueSoonActionItems: states.filter((s) => s === "DUE_SOON").length,
    overduePostmortems: resolved.filter((i) => getPostmortemStatus(i, rules, i.postmortem, today).state === "OVERDUE")
      .length,
    unlinkedStrongSuspects: suspects.length,
  };
}
