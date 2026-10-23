import { progressBy } from "@/features/action-items/service";
import type { ScopedDb } from "@/server/db/tenant";
import { summarize } from "./candidates";
import type { Accountability, Chain, ChainMember, EarlierOccurrence, OpenItem } from "./types";

const DAY = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The chain an incident belongs to (as the root or as a revenant), oldest first, or null for a standalone incident.
 * Soft-deleted incidents never appear, so every count derived from this excludes them.
 */
export async function getChain(db: ScopedDb, incidentId: string): Promise<Chain | null> {
  const self = await db.incident.findFirst({ where: { id: incidentId }, select: { id: true, revenantOfId: true } });
  if (!self) return null;
  const rootId = self.revenantOfId ?? self.id;
  const rows = await db.incident.findMany({
    where: { OR: [{ id: rootId }, { revenantOfId: rootId }] },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: { id: true, number: true, title: true, severity: true, status: true, startedAt: true, resolvedAt: true },
  });
  if (rows.length < 2) return null;
  const members: ChainMember[] = rows.map((r, i) => ({
    ...summarize(r),
    gapDays: i === 0 ? null : Math.floor((r.startedAt.getTime() - rows[i - 1].startedAt.getTime()) / DAY),
  }));
  return { rootId, members };
}

/**
 * Did the lessons from earlier occurrences get acted on? Looks at the occurrences before `currentId`: their postmortems, their
 * action items (counts, and the ones still open), all from this workspace and excluding soft-deleted incidents.
 */
export async function getAccountability(
  db: ScopedDb,
  chain: Chain,
  currentId: string,
  now: Date = new Date(),
): Promise<Accountability> {
  const at = chain.members.findIndex((m) => m.id === currentId);
  const earlierMembers = at < 0 ? [] : chain.members.slice(0, at);
  const ids = earlierMembers.map((m) => m.id);
  if (ids.length === 0) {
    return { earlier: [], openItems: [], totals: { items: 0, done: 0, open: 0, overdue: 0 }, allDone: false };
  }

  const [postmortems, items] = await Promise.all([
    db.postmortem.findMany({
      where: { incidentId: { in: ids } },
      select: { id: true, status: true, incidentId: true },
    }),
    db.actionItem.findMany({
      where: { incidentId: { in: ids }, incident: { deletedAt: null } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      select: { id: true, title: true, status: true, dueDate: true, ownerId: true, incidentId: true },
    }),
  ]);
  const progress = await progressBy(
    db,
    "postmortemId",
    postmortems.map((p) => p.id),
    now,
  );
  const pmByIncident = new Map(postmortems.map((p) => [p.incidentId, p]));

  const earlier: EarlierOccurrence[] = earlierMembers.map((m) => {
    const pm = pmByIncident.get(m.id);
    return {
      incident: m,
      postmortem: pm ? { id: pm.id, status: pm.status } : null,
      progress: pm ? (progress.get(pm.id) ?? { done: 0, total: 0, overdue: 0 }) : null,
    };
  });

  const today = dayOf(now);
  const numberOf = new Map(earlierMembers.map((m) => [m.id, m.number]));
  const open: OpenItem[] = items
    .filter((i) => i.status === "OPEN" || i.status === "IN_PROGRESS")
    .map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status as "OPEN" | "IN_PROGRESS",
      dueDate: i.dueDate ? dayOf(i.dueDate) : null,
      ownerId: i.ownerId,
      incidentNumber: numberOf.get(i.incidentId) ?? 0,
      overdue: i.dueDate !== null && dayOf(i.dueDate) < today,
    }));
  const counted = items.filter((i) => i.status !== "WONT_DO");
  return {
    earlier,
    openItems: open,
    totals: {
      items: counted.length,
      done: counted.filter((i) => i.status === "DONE").length,
      open: open.length,
      overdue: open.filter((i) => i.overdue).length,
    },
    allDone: counted.length > 0 && open.length === 0,
  };
}
