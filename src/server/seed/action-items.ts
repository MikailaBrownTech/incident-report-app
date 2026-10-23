import { generateNKeysBetween } from "fractional-indexing";
import type { PrismaClient } from "@/generated/prisma/client";
import { addDays, utcDay } from "@/features/action-items/state";

/**
 * Seeded action items, shared by the demo seed and `seed:mine`. Dates are relative to "now" so the board always has
 * overdue, due-soon and later items, whenever the seed runs.
 */

export interface SeedActionItem {
  title: string;
  description?: string;
  /** Index into the people list the seed maps (0 = the signed-in user). */
  owner: number;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "WONT_DO";
  /** Days from now (negative = in the past); null for no due date. */
  dueInDays: number | null;
  /** DONE only: how many days ago it was completed. */
  completedDaysAgo?: number;
  /** WONT_DO only. */
  reason?: string;
}

const DAY = 86_400_000;

export interface EnsureItemsInput {
  workspaceId: string;
  postmortem: { id: string; incidentId: string; createdAt: Date };
  items: SeedActionItem[];
  /** Maps an owner index to a real member's user id. */
  personAt: (index: number) => string;
  now: Date;
}

/**
 * Adds the items to the postmortem unless it already has any (so a re-run adds nothing, and what people changed or
 * deleted stays that way). Each item gets a position at the end of its column, and a timeline entry when created and
 * again when completed. Returns how many it created.
 */
export async function ensureSeedActionItems(db: PrismaClient, input: EnsureItemsInput): Promise<number> {
  const { workspaceId, postmortem, items, personAt, now } = input;
  if (await db.actionItem.count({ where: { postmortemId: postmortem.id } })) return 0;

  // new items go to the end of their column
  const keys = new Map<string, string[]>();
  for (const status of ["OPEN", "IN_PROGRESS", "DONE", "WONT_DO"] as const) {
    const last = await db.actionItem.findFirst({
      where: { workspaceId, status },
      orderBy: [{ position: "desc" }, { id: "desc" }],
      select: { position: true },
    });
    keys.set(
      status,
      generateNKeysBetween(last?.position ?? null, null, items.filter((i) => i.status === status).length),
    );
  }
  const used = { OPEN: 0, IN_PROGRESS: 0, DONE: 0, WONT_DO: 0 };

  await db.$transaction(async (tx) => {
    for (const [n, item] of items.entries()) {
      const owner = personAt(item.owner);
      // spread creation over the days after the postmortem was started
      const createdAt = new Date(Math.min(postmortem.createdAt.getTime() + (n + 1) * 3_600_000, now.getTime()));
      const completedAt = item.status === "DONE" ? new Date(now.getTime() - (item.completedDaysAgo ?? 1) * DAY) : null;
      const created = await tx.actionItem.create({
        data: {
          workspaceId,
          postmortemId: postmortem.id,
          incidentId: postmortem.incidentId,
          title: item.title,
          description: item.description ?? "",
          ownerId: owner,
          createdById: owner,
          dueDate: item.dueInDays === null ? null : new Date(`${addDays(utcDay(now), item.dueInDays)}T00:00:00.000Z`),
          status: item.status,
          wontDoReason: item.status === "WONT_DO" ? (item.reason ?? "No longer needed") : null,
          completedAt,
          position: keys.get(item.status)![used[item.status]++],
          createdAt,
          updatedAt: completedAt ?? createdAt,
        },
      });
      const event = (type: "RITUAL_CREATED" | "RITUAL_COMPLETED", at: Date) =>
        tx.event.create({
          data: {
            workspaceId,
            incidentId: postmortem.incidentId,
            type,
            source: "USER",
            actorId: owner,
            payload: { actionItemId: created.id, title: created.title },
            occurredAt: at,
            createdAt: at,
            updatedAt: at,
          },
        });
      await event("RITUAL_CREATED", createdAt);
      if (completedAt) await event("RITUAL_COMPLETED", completedAt);
    }
  });
  return items.length;
}
