import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { IncidentRole, IncidentStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { createWorkspaceWithOwner } from "@/server/db/root";
import { DUE_SOON_KEY, DUE_SOON_RESOLVED_DAYS_AGO, seedPostmortemsFor } from "./mine-postmortems";
import { ensureSeedActionItems } from "./action-items";
import { MINE_ACTION_ITEMS } from "./mine-action-items";
import { ensureSeedPostmortem } from "./postmortems";
import { ensureSeedRevenantLink } from "./revenants";

/**
 * Loads `prisma/seed-incidents.json` into the signed-in user's own workspace (`pnpm seed:mine`).
 *
 * Unlike the demo seed this never creates users and only ever touches one workspace. Every incident it
 * creates carries `Incident.seedKey` (a slug of the fixture title), which is what makes a re-run a no-op and
 * what `--reset` uses to remove exactly the rows it added, nothing else.
 *
 * Takes the Prisma client as a parameter so tests can run it against a throwaway schema; the confirmation
 * prompt is a callback so the CLI owns all terminal I/O.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FIXTURE = "prisma/seed-incidents.json";
const NEW_WORKSPACE_NAME = "The Crypt Demo";
const NEW_WORKSPACE_SLUG = "the-crypt-demo";

const fixtureSchema = z.object({
  services: z.array(z.object({ name: z.string().min(1), slug: z.string().min(1) })).min(1),
  incidents: z
    .array(
      z.object({
        title: z.string().min(1).max(140),
        summary: z.string(),
        severity: z.number().int().min(1).max(5),
        status: z.enum(["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"]),
        services: z.array(z.string()),
        startedHoursAgo: z.number().positive(),
        durationMinutes: z.number().positive().nullable(),
        rootCause: z.string().optional(),
        commander: z.number().int().min(0).nullable(),
        scribe: z.number().int().min(0).nullable(),
        notes: z.array(z.object({ minutesAfterStart: z.number().min(0), body: z.string().min(1) })),
      }),
    )
    .min(1),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export class SeedMineError extends Error {}

export async function loadFixture(file = path.resolve(process.cwd(), FIXTURE)): Promise<Fixture> {
  const parsed = fixtureSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) throw new SeedMineError(`${FIXTURE} is not in the expected shape: ${parsed.error.message}`);
  const keys = parsed.data.incidents.map((i) => seedKeyOf(i.title));
  if (new Set(keys).size !== keys.length) throw new SeedMineError(`${FIXTURE} has two incidents with the same title.`);
  return parsed.data;
}

/** The stable identity of a fixture incident. */
export const seedKeyOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export interface MineOptions {
  email: string;
  /** Workspace slug; the user must be a member. */
  workspace?: string;
  reset?: boolean;
  now?: Date;
  fixture?: Fixture;
  /** Asked once, before anything is written. Return false to stop. */
  confirm: (plan: MinePlan) => Promise<boolean>;
}

export interface MinePlan {
  workspaceName: string;
  workspaceSlug: string;
  /** True when the user has no workspace and one will be created after confirming. */
  createsWorkspace: boolean;
  mode: "seed" | "reset";
  /** Reset only: how many seeded incidents will be deleted / kept because they have a postmortem. */
  resetCount?: number;
  resetKept?: number;
}

export interface MineResult {
  cancelled: boolean;
  workspaceSlug: string;
  workspaceCreated: boolean;
  servicesCreated: number;
  incidentsCreated: number;
  incidentsSkipped: number;
  eventsCreated: number;
  postmortemsCreated: number;
  actionItemsCreated: number;
  revenantLinksCreated: number;
  numbers: number[];
  incidentsDeleted: number;
  incidentsKept: number;
}

const ORDER: IncidentStatus[] = ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"];

export async function seedMine(db: PrismaClient, opts: MineOptions): Promise<MineResult> {
  const now = opts.now ?? new Date();
  const email = opts.email.trim().toLowerCase();

  // 1. the user must already exist; never create one
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new SeedMineError("Sign in once in the app first so your account exists.");

  // 2. the workspace
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let workspace: { id: string; name: string; slug: string } | null = null;
  let createsWorkspace = false;
  if (opts.workspace) {
    const found = memberships.find((m) => m.workspace.slug === opts.workspace);
    if (!found) {
      throw new SeedMineError(`You are not a member of a workspace called "${opts.workspace}".`);
    }
    workspace = found.workspace;
  } else if (memberships.length === 1) {
    workspace = memberships[0].workspace;
  } else if (memberships.length > 1) {
    const list = memberships.map((m) => `  ${m.workspace.slug}  (${m.workspace.name})`).join("\n");
    throw new SeedMineError(`You belong to several workspaces. Rerun with --workspace <slug>:\n${list}`);
  } else {
    createsWorkspace = true;
  }

  const base: Omit<MineResult, "cancelled" | "workspaceSlug"> = {
    workspaceCreated: false,
    servicesCreated: 0,
    incidentsCreated: 0,
    incidentsSkipped: 0,
    eventsCreated: 0,
    postmortemsCreated: 0,
    actionItemsCreated: 0,
    revenantLinksCreated: 0,
    numbers: [],
    incidentsDeleted: 0,
    incidentsKept: 0,
  };

  // --reset: only seeded incidents, and never one a person has written a postmortem for
  if (opts.reset) {
    if (!workspace) {
      return { ...base, cancelled: false, workspaceSlug: NEW_WORKSPACE_SLUG }; // nothing to reset
    }
    const seeded = await db.incident.findMany({
      where: { workspaceId: workspace.id, seedKey: { not: null } },
      select: { id: true, postmortem: { select: { id: true } } },
    });
    const deletable = seeded.filter((i) => !i.postmortem).map((i) => i.id);
    const plan: MinePlan = {
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      createsWorkspace: false,
      mode: "reset",
      resetCount: deletable.length,
      resetKept: seeded.length - deletable.length,
    };
    if (deletable.length === 0) {
      return { ...base, cancelled: false, workspaceSlug: workspace.slug, incidentsKept: plan.resetKept! };
    }
    if (!(await opts.confirm(plan))) return { ...base, cancelled: true, workspaceSlug: workspace.slug };
    // events, service links and role assignments go with the incident (ON DELETE CASCADE)
    const { count } = await db.incident.deleteMany({
      where: { workspaceId: workspace.id, id: { in: deletable }, seedKey: { not: null } },
    });
    return {
      ...base,
      cancelled: false,
      workspaceSlug: workspace.slug,
      incidentsDeleted: count,
      incidentsKept: plan.resetKept!,
    };
  }

  // 3. confirm before writing anything (including the workspace)
  const plan: MinePlan = {
    workspaceName: workspace?.name ?? NEW_WORKSPACE_NAME,
    workspaceSlug: workspace?.slug ?? NEW_WORKSPACE_SLUG,
    createsWorkspace,
    mode: "seed",
  };
  if (!(await opts.confirm(plan))) return { ...base, cancelled: true, workspaceSlug: plan.workspaceSlug };

  if (!workspace) {
    workspace = await createDemoWorkspace(db, user.id);
    base.workspaceCreated = true;
  }
  const workspaceId = workspace.id;
  const fixture = opts.fixture ?? (await loadFixture());

  // 4. services, matched by slug within the workspace (a same-named service with another slug is reused too)
  const serviceId = new Map<string, string>();
  for (const s of fixture.services) {
    const existing =
      (await db.service.findUnique({ where: { workspaceId_slug: { workspaceId, slug: s.slug } } })) ??
      (await db.service.findFirst({ where: { workspaceId, name: { equals: s.name, mode: "insensitive" } } }));
    if (existing) {
      serviceId.set(s.slug, existing.id);
      continue;
    }
    const created = await db.service.create({ data: { workspaceId, name: s.name, slug: s.slug } });
    serviceId.set(s.slug, created.id);
    base.servicesCreated += 1;
  }

  // 6. people: me first, then the other members in a stable order; out-of-range indexes fall back to me
  const others = await db.membership.findMany({
    where: { workspaceId, userId: { not: user.id } },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    select: { userId: true },
  });
  const people = [user.id, ...others.map((m) => m.userId)];
  const personAt = (index: number | null) => (index === null ? null : (people[index] ?? user.id));

  const postmortemPlans = seedPostmortemsFor(fixture);

  // 5. incidents, one transaction each
  for (const spec of fixture.incidents) {
    const seedKey = seedKeyOf(spec.title);
    // soft-deleted ones count as existing: a deleted demo incident is not resurrected
    const found = await db.incident.findUnique({
      where: { workspaceId_seedKey: { workspaceId, seedKey } },
      select: { id: true },
    });
    if (found) {
      base.incidentsSkipped += 1;
      continue;
    }

    // One resolved incident is given a recent resolution so its postmortem shows as "due soon" (see mine-postmortems.ts).
    const durationMs = (spec.durationMinutes ?? 60) * MIN;
    const dueSoon = seedKey === DUE_SOON_KEY && spec.status === "RESOLVED" && !postmortemPlans.has(seedKey);
    const resolvedAt =
      spec.status === "RESOLVED"
        ? dueSoon
          ? new Date(now.getTime() - DUE_SOON_RESOLVED_DAYS_AGO * DAY)
          : new Date(now.getTime() - spec.startedHoursAgo * HOUR + durationMs)
        : null;
    const startedAt =
      dueSoon && resolvedAt
        ? new Date(resolvedAt.getTime() - durationMs)
        : new Date(now.getTime() - spec.startedHoursAgo * HOUR);
    const end = (resolvedAt ?? now).getTime();
    const span = end - startedAt.getTime();
    const at = (fraction: number) => new Date(startedAt.getTime() + Math.floor(span * fraction));

    const commander = personAt(spec.commander);
    const scribe = personAt(spec.scribe);
    const lead = commander ?? scribe ?? user.id;
    const roles: { role: IncidentRole; userId: string }[] = [];
    if (commander) roles.push({ role: "COMMANDER", userId: commander });
    if (scribe) roles.push({ role: "SCRIBE", userId: scribe });

    type EventRow = Omit<Prisma.EventCreateManyInput, "workspaceId" | "incidentId">;
    const events: EventRow[] = [];
    const add = (e: Omit<EventRow, "createdAt" | "updatedAt">) =>
      // recorded when it happened, so nothing reads "added later"
      events.push({ ...e, createdAt: e.occurredAt, updatedAt: e.occurredAt });

    add({
      type: "STATUS_CHANGED",
      source: "SYSTEM",
      actorId: user.id,
      payload: { to: "INVESTIGATING", created: true },
      occurredAt: startedAt,
    });
    roles.forEach((r, i) =>
      add({
        type: "ROLE_ASSIGNED",
        source: "USER",
        actorId: lead,
        payload: { role: r.role, from: null, to: r.userId },
        occurredAt: new Date(startedAt.getTime() + (2 + i) * MIN),
      }),
    );
    let previous: IncidentStatus = "INVESTIGATING";
    ORDER.slice(1, ORDER.indexOf(spec.status) + 1).forEach((to, i) => {
      add({
        type: "STATUS_CHANGED",
        source: "USER",
        actorId: lead,
        payload: { from: previous, to },
        occurredAt: to === "RESOLVED" ? resolvedAt! : at((to === "IDENTIFIED" ? 0.15 : 0.5) + i * 0.001),
      });
      previous = to;
    });
    for (const note of spec.notes) {
      add({
        type: "NOTE",
        source: "USER",
        actorId: scribe ?? lead,
        body: note.body,
        // never after the incident ended (or after now, for open ones)
        occurredAt: new Date(Math.min(startedAt.getTime() + note.minutesAfterStart * MIN, end)),
      });
    }

    const number = await db.$transaction(async (tx) => {
      // atomic counter, same as declaring an incident
      const { nextIncidentNumber } = await tx.workspace.update({
        where: { id: workspaceId },
        data: { nextIncidentNumber: { increment: 1 } },
        select: { nextIncidentNumber: true },
      });
      const incident = await tx.incident.create({
        data: {
          workspaceId,
          number: nextIncidentNumber - 1,
          seedKey,
          title: spec.title,
          summary: spec.summary,
          severity: spec.severity,
          status: spec.status,
          startedAt,
          resolvedAt,
          createdById: user.id,
          services: {
            create: spec.services.map((slug) => {
              const id = serviceId.get(slug);
              if (!id) throw new SeedMineError(`"${spec.title}" references unknown service "${slug}".`);
              return { serviceId: id };
            }),
          },
          assignments: { create: roles },
        },
        select: { id: true, number: true },
      });
      await tx.event.createMany({ data: events.map((e) => ({ ...e, workspaceId, incidentId: incident.id })) });
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: user.id,
          action: "incident.created",
          targetType: "incident",
          targetId: incident.id,
          metadata: { number: incident.number, severity: spec.severity, status: spec.status, seeded: true },
          createdAt: startedAt,
        },
      });
      return incident.number;
    });
    base.incidentsCreated += 1;
    base.eventsCreated += events.length;
    base.numbers.push(number);
  }

  // 8. postmortems: published and draft ones for a few incidents, none for the rest (so those show as overdue)
  for (const spec of fixture.incidents) {
    const plan = postmortemPlans.get(seedKeyOf(spec.title));
    if (!plan) continue;
    const incident = await db.incident.findUnique({
      where: { workspaceId_seedKey: { workspaceId, seedKey: seedKeyOf(spec.title) } },
      select: { id: true, number: true, severity: true, resolvedAt: true },
    });
    if (!incident) continue;
    const created = await ensureSeedPostmortem(db, {
      workspaceId,
      incident,
      spec: plan,
      authorId: personAt(spec.scribe) ?? user.id,
      publisherId: personAt(spec.commander) ?? user.id,
      now,
    });
    if (created) {
      base.postmortemsCreated += 1;
      base.eventsCreated += plan.status === "PUBLISHED" ? 2 : 1;
    }

    // 9. action items for that postmortem (skipped if it already has any)
    const items = MINE_ACTION_ITEMS[seedKeyOf(spec.title)];
    const postmortem = items
      ? await db.postmortem.findUnique({
          where: { incidentId: incident.id },
          select: { id: true, incidentId: true, createdAt: true },
        })
      : null;
    if (items && postmortem) {
      const made = await ensureSeedActionItems(db, {
        workspaceId,
        postmortem,
        items,
        personAt: (i) => people[i] ?? user.id,
        now,
      });
      base.actionItemsCreated += made;
      if (made) base.eventsCreated += made + items.filter((i) => i.status === "DONE").length; // created + completed entries
    }
  }

  // 10. recurrences: two chains are linked; the two search incidents are deliberately left unlinked, so they show up as
  // suggestions and under "Unlinked suspects"
  for (const [laterKey, rootKey] of REVENANT_LINKS) {
    const [later, root] = await Promise.all(
      [laterKey, rootKey].map((seedKey) =>
        db.incident.findUnique({
          where: { workspaceId_seedKey: { workspaceId, seedKey } },
          select: { id: true, number: true, title: true, startedAt: true, revenantOfId: true },
        }),
      ),
    );
    if (!later || !root) continue;
    if (await ensureSeedRevenantLink(db, { workspaceId, actorId: user.id, incident: later, root, now })) {
      base.revenantLinksCreated += 1;
      base.eventsCreated += 2;
    }
  }

  return { ...base, cancelled: false, workspaceSlug: workspace.slug };
}

/** [later incident, the root it recurs] by seed key. */
const REVENANT_LINKS: [string, string][] = [
  ["checkout-api-timeout-spike", "checkout-api-timeouts-during-flash-sale"],
  ["checkout-api-timeouts-on-card-payments", "checkout-api-timeouts-during-flash-sale"],
  ["payment-webhooks-retrying-endlessly", "payment-webhook-failures"],
  ["payment-webhook-failures-from-provider", "payment-webhook-failures"],
];

/** The normal workspace-creation path (OWNER membership, default template, retro rule, audit row). */
async function createDemoWorkspace(db: PrismaClient, userId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? NEW_WORKSPACE_SLUG : `${NEW_WORKSPACE_SLUG}-${attempt + 1}`;
    if (await db.workspace.findUnique({ where: { slug }, select: { id: true } })) continue;
    const result = await createWorkspaceWithOwner({ userId, name: NEW_WORKSPACE_NAME, slug });
    if (result.ok) return result.workspace;
    if (result.error !== "slug_taken") throw new SeedMineError(`Could not create a workspace (${result.error}).`);
  }
  throw new SeedMineError("Could not find a free workspace slug; rerun with --workspace.");
}
