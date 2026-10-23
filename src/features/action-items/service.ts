import type { PersonView } from "@/features/incidents/schema";
import { Prisma } from "@/generated/prisma/client";
import type { WorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";
import { lockWorkspace } from "@/server/db/lock";
import { usersByIds } from "@/server/db/root";
import type { ScopedDb } from "@/server/db/tenant";
import { byPosition, keyBetween, needsRebalance, rebalancedKeys, slotFor, type Positioned } from "./order";
import {
  RECENT_DAYS,
  STATUSES,
  type ActionItemView,
  type ActionStatus,
  type BoardColumn,
  type BoardPayload,
  type ItemFilters,
  type ItemsPayload,
  type ListParams,
  type Progress,
} from "./schema";
import { addDays, isOpenStatus, utcDay } from "./state";

type Ctx = Pick<WorkspaceContext, "db" | "workspace" | "membership" | "user">;

export type ItemError = "not_found" | "no_postmortem" | "invalid_owner" | "forbidden" | "reason_required";
export type ItemResult = ({ ok: true } & ItemsPayload) | { ok: false; error: ItemError };

const INCIDENT_SELECT = { select: { id: true, number: true, title: true, severity: true } } as const;
const OPEN: ActionStatus[] = ["OPEN", "IN_PROGRESS"];
const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

type Row = Prisma.ActionItemGetPayload<{ include: { incident: typeof INCIDENT_SELECT } }>;

export function toView(r: Row): ActionItemView {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    wontDoReason: r.wontDoReason,
    dueDate: r.dueDate ? utcDay(r.dueDate) : null,
    completedAt: r.completedAt?.toISOString() ?? null,
    ownerId: r.ownerId,
    createdById: r.createdById,
    position: r.position,
    postmortemId: r.postmortemId,
    incident: r.incident,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Names for owners, including people who have since left (their ids stay on the items). */
export async function peopleOf(items: ActionItemView[]): Promise<Record<string, PersonView>> {
  const users = await usersByIds(items.flatMap((i) => [i.ownerId, i.createdById]));
  return Object.fromEntries(users.map((u) => [u.id, { userId: u.id, name: u.name, email: u.email, image: u.image }]));
}

async function payload(items: Row[]): Promise<ItemsPayload> {
  const views = items.map(toView);
  return { items: views, people: await peopleOf(views) };
}

/** Items of soft-deleted incidents are hidden everywhere. `scopedDb` can't see through a nested filter, so it is added here. */
const LIVE: Prisma.ActionItemWhereInput = { incident: { deletedAt: null } };

function filterWhere(f: ItemFilters, userId: string, today: string): Prisma.ActionItemWhereInput[] {
  const and: Prisma.ActionItemWhereInput[] = [LIVE];
  if (f.owner === "me") and.push({ ownerId: userId });
  else if (f.owner !== "any") and.push({ ownerId: f.owner });
  if (f.overdue) and.push({ status: { in: OPEN }, dueDate: { lt: dayToDate(today) } });
  if (f.dueThisWeek)
    and.push({ status: { in: OPEN }, dueDate: { gte: dayToDate(today), lte: dayToDate(addDays(today, 7)) } });
  if (f.incident !== null) and.push({ incident: { number: f.incident } });
  if (f.q) {
    const like = { contains: escapeLike(f.q), mode: "insensitive" as const };
    and.push({ OR: [{ title: like }, { description: like }] });
  }
  return and;
}

// ---- reading ----------------------------------------------------------------------------------------------------

export async function listItems(
  ctx: Pick<Ctx, "db" | "user">,
  params: ListParams,
  now: Date = new Date(),
): Promise<ItemsPayload & { nextCursor: string | null }> {
  const where: Prisma.ActionItemWhereInput[] = filterWhere(params, ctx.user.id, utcDay(now));
  if (params.status.length > 0) where.push({ status: { in: params.status } });
  const orderBy: Prisma.ActionItemOrderByWithRelationInput[] =
    params.sort === "due"
      ? [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }]
      : params.sort === "created"
        ? [{ createdAt: "asc" }, { id: "asc" }]
        : [{ title: "asc" }, { id: "asc" }];
  const rows = await ctx.db.actionItem.findMany({
    where: { AND: where },
    orderBy,
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    include: { incident: INCIDENT_SELECT },
  });
  const page = rows.slice(0, params.limit);
  return { ...(await payload(page)), nextCursor: rows.length > params.limit ? page[page.length - 1].id : null };
}

const encodeCursor = (p: string, i: string) => Buffer.from(JSON.stringify({ p, i })).toString("base64url");
function decodeCursor(cursor: string): { p: string; i: string } | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { p: unknown; i: unknown };
    return typeof v.p === "string" && typeof v.i === "string" ? { p: v.p, i: v.i } : null;
  } catch {
    return null;
  }
}

async function boardColumn(
  ctx: Pick<Ctx, "db" | "user">,
  params: ListParams,
  status: ActionStatus,
  cursor: string | null,
  now: Date,
): Promise<BoardColumn & { rows: Row[] }> {
  const and = filterWhere(params, ctx.user.id, utcDay(now));
  and.push({ status });
  // Done and Won't do show only recent cards unless asked for everything
  if (!params.all && (status === "DONE" || status === "WONT_DO")) {
    const cutoff = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
    and.push(status === "DONE" ? { completedAt: { gte: cutoff } } : { updatedAt: { gte: cutoff } });
  }
  const at = cursor ? decodeCursor(cursor) : null;
  const page: Prisma.ActionItemWhereInput[] = at
    ? [{ OR: [{ position: { gt: at.p } }, { position: at.p, id: { gt: at.i } }] }]
    : [];
  const [rows, count] = await Promise.all([
    ctx.db.actionItem.findMany({
      where: { AND: [...and, ...page] },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: params.limit + 1,
      include: { incident: INCIDENT_SELECT },
    }),
    ctx.db.actionItem.count({ where: { AND: and } }),
  ]);
  const shown = rows.slice(0, params.limit);
  const last = shown[shown.length - 1];
  return {
    status,
    rows: shown,
    items: shown.map(toView),
    count,
    nextCursor: rows.length > params.limit && last ? encodeCursor(last.position, last.id) : null,
  };
}

/** The four columns, each ordered by position, or just one (`params.column`) when paging it. */
export async function getBoard(
  ctx: Pick<Ctx, "db" | "user">,
  params: ListParams,
  now: Date = new Date(),
): Promise<BoardPayload> {
  const statuses = params.column ? [params.column] : [...STATUSES];
  const columns = await Promise.all(
    statuses.map((s) => boardColumn(ctx, params, s, params.column ? params.cursor : null, now)),
  );
  const all = columns.flatMap((c) => c.items);
  return {
    columns: columns.map((c) => ({ status: c.status, items: c.items, count: c.count, nextCursor: c.nextCursor })),
    people: await peopleOf(all),
    today: utcDay(now),
  };
}

export async function getItem(ctx: Pick<Ctx, "db">, id: string): Promise<ItemsPayload | null> {
  const row = await ctx.db.actionItem.findFirst({ where: { id, ...LIVE }, include: { incident: INCIDENT_SELECT } });
  return row ? payload([row]) : null;
}

// ---- progress ---------------------------------------------------------------------------------------------------

/**
 * Done of total (not counting "won't do") and how many are overdue, per incident or per postmortem. Items of
 * soft-deleted incidents don't count.
 */
export async function progressBy(
  db: ScopedDb,
  key: "incidentId" | "postmortemId",
  ids: string[],
  now: Date = new Date(),
): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>(ids.map((id) => [id, { done: 0, total: 0, overdue: 0 }]));
  if (ids.length === 0) return out;
  const where = { [key]: { in: ids }, ...LIVE } as Prisma.ActionItemWhereInput;
  const [byStatus, late] = await Promise.all([
    db.actionItem.groupBy({ by: [key, "status"], where, _count: { _all: true } }),
    db.actionItem.groupBy({
      by: [key],
      where: { AND: [where, { status: { in: OPEN }, dueDate: { lt: dayToDate(utcDay(now)) } }] },
      _count: { _all: true },
    }),
  ]);
  for (const row of byStatus) {
    const p = out.get(row[key] as string)!;
    if (row.status !== "WONT_DO") p.total += row._count._all;
    if (row.status === "DONE") p.done += row._count._all;
  }
  for (const row of late) out.get(row[key] as string)!.overdue = row._count._all;
  return out;
}

/** The sidebar badge: my open items that are past due. */
export const countMyOverdue = (db: ScopedDb, userId: string, now: Date = new Date()) =>
  db.actionItem.count({
    where: { AND: [LIVE, { ownerId: userId, status: { in: OPEN }, dueDate: { lt: dayToDate(utcDay(now)) } }] },
  });

// ---- writing ----------------------------------------------------------------------------------------------------

const isMember = async (db: ScopedDb, userId: string) =>
  !!(await db.membership.findFirst({ where: { userId }, select: { id: true } }));
const isAdmin = (ctx: Pick<Ctx, "membership">) => hasRole(ctx.membership.role, "ADMIN");

export async function createItem(
  ctx: Ctx,
  incidentNumber: number,
  input: { title: string; description: string; ownerId?: string; dueDate?: string | null },
): Promise<ItemResult> {
  const incident = await ctx.db.incident.findFirst({ where: { number: incidentNumber }, select: { id: true } });
  if (!incident) return { ok: false, error: "not_found" };
  const postmortem = await ctx.db.postmortem.findFirst({ where: { incidentId: incident.id }, select: { id: true } });
  if (!postmortem) return { ok: false, error: "no_postmortem" };
  const ownerId = input.ownerId ?? ctx.user.id;
  if (!(await isMember(ctx.db, ownerId))) return { ok: false, error: "invalid_owner" };

  const row = await ctx.db.$transaction(async (tx) => {
    await lockWorkspace(tx, ctx.workspace.id);
    const last = await tx.actionItem.findFirst({
      where: { status: "OPEN" },
      orderBy: [{ position: "desc" }, { id: "desc" }],
      select: { position: true },
    });
    const created = await tx.actionItem.create({
      data: {
        workspaceId: ctx.workspace.id,
        postmortemId: postmortem.id,
        incidentId: incident.id,
        title: input.title,
        description: input.description,
        ownerId,
        createdById: ctx.user.id,
        dueDate: input.dueDate ? dayToDate(input.dueDate) : null,
        position: keyBetween(last?.position ?? null, null),
      },
      include: { incident: INCIDENT_SELECT },
    });
    // one timeline event for creating an item (not for every later edit)
    await tx.event.create({
      data: {
        workspaceId: ctx.workspace.id,
        incidentId: incident.id,
        type: "RITUAL_CREATED",
        source: "USER",
        actorId: ctx.user.id,
        payload: { actionItemId: created.id, title: created.title },
      },
    });
    return created;
  });
  return { ok: true, ...(await payload([row])) };
}

export interface ItemPatch {
  title?: string;
  description?: string;
  ownerId?: string;
  dueDate?: string | null;
  status?: ActionStatus;
  wontDoReason?: string;
  afterId?: string | null;
  beforeId?: string | null;
}

/** Read the column (without `skipId`) in order, rebalancing first if keys collide or have grown long. */
async function columnOf(tx: Pick<ScopedDb, "actionItem">, status: ActionStatus, skipId: string): Promise<Positioned[]> {
  const rows = await tx.actionItem.findMany({
    where: { status, NOT: { id: skipId } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, position: true },
  });
  if (!needsRebalance(rows)) return rows;
  const keys = rebalancedKeys(rows.length);
  const fresh: Positioned[] = [];
  for (const [i, row] of rows.entries()) {
    await tx.actionItem.update({ where: { id: row.id }, data: { position: keys[i] } });
    fresh.push({ id: row.id, position: keys[i] });
  }
  return fresh;
}

/**
 * Edit, reassign or move an item. Only its owner or an admin may. Moving sends the card the client dropped it beside
 * (`afterId` / `beforeId`); the position is worked out here, inside a transaction holding the workspace lock, from the
 * column as it is NOW, so two simultaneous drops into the same slot get distinct, correctly ordered positions.
 */
export async function updateItem(ctx: Ctx, id: string, patch: ItemPatch, now: Date = new Date()): Promise<ItemResult> {
  const item = await ctx.db.actionItem.findFirst({ where: { id, ...LIVE }, include: { incident: INCIDENT_SELECT } });
  if (!item) return { ok: false, error: "not_found" };
  if (item.ownerId !== ctx.user.id && !isAdmin(ctx)) return { ok: false, error: "forbidden" };
  if (patch.ownerId !== undefined && patch.ownerId !== item.ownerId && !(await isMember(ctx.db, patch.ownerId))) {
    return { ok: false, error: "invalid_owner" };
  }

  const status = patch.status ?? item.status;
  const changedStatus = status !== item.status;
  const reason = (patch.wontDoReason ?? item.wontDoReason ?? "").trim();
  if (status === "WONT_DO" && changedStatus && !reason) return { ok: false, error: "reason_required" };
  if (status === "WONT_DO" && !changedStatus && patch.wontDoReason !== undefined && !reason) {
    return { ok: false, error: "reason_required" };
  }
  const reposition = changedStatus || patch.afterId !== undefined || patch.beforeId !== undefined;

  const data: Prisma.ActionItemUncheckedUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.ownerId !== undefined) data.ownerId = patch.ownerId;
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ? dayToDate(patch.dueDate) : null;
  if (changedStatus) {
    data.status = status;
    data.completedAt = status === "DONE" ? now : null; // moving to DONE stamps it, moving away clears it
  }
  // the reason belongs to WONT_DO only
  if (status === "WONT_DO") {
    if (changedStatus || patch.wontDoReason !== undefined) data.wontDoReason = reason;
  } else if (item.wontDoReason !== null) {
    data.wontDoReason = null;
  }

  const row = await ctx.db.$transaction(async (tx) => {
    await lockWorkspace(tx, ctx.workspace.id);
    if (reposition) {
      let column = await columnOf(tx, status, id);
      let [lo, hi] = slotFor(column, patch.afterId ?? null, patch.beforeId ?? null);
      if (lo !== null && hi !== null && lo >= hi) {
        // identical keys survived (possible only before the first rebalance); spread the column and try again
        const keys = rebalancedKeys(column.length);
        column = column.map((c, i) => ({ ...c, position: keys[i] }));
        for (const c of column) await tx.actionItem.update({ where: { id: c.id }, data: { position: c.position } });
        [lo, hi] = slotFor(column, patch.afterId ?? null, patch.beforeId ?? null);
      }
      data.position = keyBetween(lo, hi);
    }
    const updated = await tx.actionItem.update({ where: { id }, data, include: { incident: INCIDENT_SELECT } });
    // completing an item writes one timeline event; other edits and moves write none
    if (status === "DONE" && item.status !== "DONE") {
      await tx.event.create({
        data: {
          workspaceId: ctx.workspace.id,
          incidentId: item.incidentId,
          type: "RITUAL_COMPLETED",
          source: "USER",
          actorId: ctx.user.id,
          payload: { actionItemId: id, title: updated.title },
          occurredAt: now,
        },
      });
    }
    return updated;
  });
  return { ok: true, ...(await payload([row])) };
}

/** Admins and owners only. */
export async function deleteItem(
  ctx: Ctx,
  id: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "forbidden" }> {
  if (!isAdmin(ctx)) return { ok: false, error: "forbidden" };
  const item = await ctx.db.actionItem.findFirst({ where: { id, ...LIVE }, select: { id: true } });
  if (!item) return { ok: false, error: "not_found" };
  await ctx.db.actionItem.delete({ where: { id } });
  return { ok: true };
}

export { isOpenStatus, byPosition };
