import type { Event, Prisma } from "@/generated/prisma/client";
import type { PersonView } from "@/features/incidents/schema";
import { usersByIds } from "@/server/db/root";
import type { ScopedDb } from "@/server/db/tenant";
import { referencedUserIds } from "./humanize";
import {
  FILTER_TYPES,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
  type EventSourceKey,
  type TimelineChanges,
  type TimelineEventView,
  type TimelineFilter,
  type TimelineOrder,
  type TimelinePage,
} from "./schema";

/** The incident this timeline belongs to, or null if it doesn't exist, is deleted, or isn't in this workspace. */
export function findLiveIncident(db: ScopedDb, number: number) {
  return db.incident.findFirst({ where: { number }, select: { id: true, number: true, startedAt: true } });
}

export function toView(e: Event): TimelineEventView {
  return {
    id: e.id,
    type: e.type,
    source: e.source as EventSourceKey,
    actorId: e.actorId,
    body: e.body,
    payload: e.payload,
    occurredAt: e.occurredAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
    editedAt: e.editedAt?.toISOString() ?? null,
    isKeyMoment: e.isKeyMoment,
  };
}

export function filterWhere(filter: TimelineFilter): Prisma.EventWhereInput {
  if (filter === "all") return {};
  if (filter === "key") return { isKeyMoment: true };
  return { type: { in: [...FILTER_TYPES[filter]] } };
}

/** Names for everyone an entry mentions, including former members (their ids stay in the history). */
export async function resolvePeople(items: TimelineEventView[]): Promise<Record<string, PersonView>> {
  const ids = items.flatMap((e) => [...(e.actorId ? [e.actorId] : []), ...referencedUserIds(e)]);
  const users = await usersByIds(ids);
  return Object.fromEntries(users.map((u) => [u.id, { userId: u.id, name: u.name, email: u.email, image: u.image }]));
}

export interface PageQuery {
  filter: TimelineFilter;
  order: TimelineOrder;
  limit: number;
  cursor?: string | null;
}

/**
 * One page of the timeline in `order`. Keyset pagination on (occurredAt, id): the cursor is a position, not a
 * row, so it stays valid if that row is deleted, and ties on occurredAt break on id so no entry is skipped or
 * repeated. Follow `nextCursor` to continue in the same direction.
 */
export async function listTimeline(db: ScopedDb, incidentId: string, q: PageQuery): Promise<TimelinePage> {
  const forward = q.order === "asc";
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  const beyond: Prisma.EventWhereInput[] = cursor
    ? [
        {
          OR: [
            { occurredAt: forward ? { gt: cursor.t } : { lt: cursor.t } },
            { occurredAt: cursor.t, id: forward ? { gt: cursor.i } : { lt: cursor.i } },
          ],
        },
      ]
    : [];

  const limit = Math.min(q.limit, MAX_LIMIT);
  const rows = await db.event.findMany({
    where: { AND: [{ incidentId }, filterWhere(q.filter), ...beyond] },
    orderBy: [{ occurredAt: q.order }, { id: q.order }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const items = page.map(toView);
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(last.occurredAt, last.id) : null,
    people: await resolvePeople(items),
    asOf: new Date().toISOString(),
  };
}

const MAX_CHANGES = 100;

/**
 * What changed since `after` (a previous response's `asOf`): entries created or touched (edited, starred), and notes
 * deleted (found through their audit rows). Lets the client merge updates without reloading the whole feed.
 *
 * Every changed entry is returned whatever the active filter: the client applies the filter itself, so an entry that
 * just stopped matching (an un-starred note under "Key moments") is removed rather than left behind.
 */
export async function listChanges(
  db: ScopedDb,
  incident: { id: string; number: number },
  after: string,
): Promise<TimelineChanges> {
  const since = new Date(after);
  const asOf = new Date().toISOString();

  const [rows, deletions] = await Promise.all([
    db.event.findMany({
      where: { incidentId: incident.id, updatedAt: { gt: since } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: MAX_CHANGES + 1,
    }),
    db.auditLog.findMany({
      where: { action: "incident.note_deleted", targetId: incident.id, createdAt: { gt: since } },
      select: { metadata: true },
      take: MAX_CHANGES + 1,
    }),
  ]);

  const items = rows.slice(0, MAX_CHANGES).map(toView);
  const deleted = deletions
    .slice(0, MAX_CHANGES)
    .map((d) => (d.metadata as { noteId?: unknown } | null)?.noteId)
    .filter((id): id is string => typeof id === "string");

  return {
    items,
    deleted,
    people: await resolvePeople(items),
    asOf,
    truncated: rows.length > MAX_CHANGES || deletions.length > MAX_CHANGES,
  };
}
