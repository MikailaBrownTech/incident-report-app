import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import type { WorkspaceContext } from "@/server/auth/context";
import type { ScopedDb } from "@/server/db/tenant";
import type { RoleKey, StatusKey } from "./schema";

type Ctx = Pick<WorkspaceContext, "db" | "workspace" | "membership" | "user">;
type Tx = Pick<
  ScopedDb,
  "incident" | "incidentService" | "incidentAssignment" | "service" | "membership" | "event" | "auditLog"
>;

export type UpdateError = "not_found" | "invalid_service" | "not_a_member";
export type Outcome = { ok: true; changed: boolean } | { ok: false; error: UpdateError };

/** Thrown inside a transaction so everything done so far rolls back. */
class Abort extends Error {
  constructor(readonly reason: UpdateError) {
    super(reason);
  }
}

const CLIP = 2_000;
/** Summaries can be long; the event keeps a clipped copy so the timeline stays light. */
const clip = (s: string) => (s.length > CLIP ? s.slice(0, CLIP) : s);

async function run(ctx: Ctx, work: (tx: Tx) => Promise<boolean>): Promise<Outcome> {
  try {
    const changed = await ctx.db.$transaction((tx) => work(tx as Tx));
    return { ok: true, changed };
  } catch (err) {
    if (err instanceof Abort) return { ok: false, error: err.reason };
    throw err;
  }
}

async function event(
  tx: Tx,
  ctx: Ctx,
  incidentId: string,
  type:
    | "TITLE_CHANGED"
    | "SUMMARY_CHANGED"
    | "SEVERITY_CHANGED"
    | "STATUS_CHANGED"
    | "SERVICES_CHANGED"
    | "ROLE_ASSIGNED"
    | "ROLE_UNASSIGNED"
    | "INCIDENT_DELETED",
  payload: Prisma.InputJsonValue,
) {
  await tx.event.create({
    data: {
      workspaceId: ctx.workspace.id,
      incidentId,
      type,
      source: "USER",
      actorId: ctx.user.id,
      payload,
    },
  });
}

async function liveIncident(tx: Tx, number: number) {
  const incident = await tx.incident.findFirst({
    where: { number },
    include: { services: { select: { serviceId: true } } },
  });
  if (!incident) throw new Abort("not_found");
  return incident;
}

export interface PatchInput {
  title?: string;
  summary?: string;
  severity?: number;
  serviceIds?: string[];
}

/** Edit title, summary, severity and services. Each real change writes its own event; no-ops write nothing. */
export async function patchIncident(ctx: Ctx, number: number, input: PatchInput): Promise<Outcome> {
  return run(ctx, async (tx) => {
    const incident = await liveIncident(tx, number);
    const data: Prisma.IncidentUpdateInput = {};
    let changed = false;

    if (input.title !== undefined && input.title !== incident.title) {
      data.title = input.title;
      await event(tx, ctx, incident.id, "TITLE_CHANGED", { from: incident.title, to: input.title });
      changed = true;
    }

    if (input.summary !== undefined && input.summary !== incident.summary) {
      data.summary = input.summary;
      await event(tx, ctx, incident.id, "SUMMARY_CHANGED", {
        from: clip(incident.summary),
        to: clip(input.summary),
        truncated: incident.summary.length > CLIP || input.summary.length > CLIP,
      });
      changed = true;
    }

    if (input.severity !== undefined && input.severity !== incident.severity) {
      data.severity = input.severity;
      await event(tx, ctx, incident.id, "SEVERITY_CHANGED", { from: incident.severity, to: input.severity });
      await writeAudit(tx, ctx.workspace.id, {
        actorId: ctx.user.id,
        action: "incident.severity_changed",
        targetType: "incident",
        targetId: incident.id,
        metadata: { number, from: incident.severity, to: input.severity },
      });
      changed = true;
    }

    if (input.serviceIds !== undefined) {
      const next = [...new Set(input.serviceIds)];
      const current = incident.services.map((s) => s.serviceId);
      const added = next.filter((id) => !current.includes(id));
      const removed = current.filter((id) => !next.includes(id));

      if (added.length > 0 || removed.length > 0) {
        if (next.length > 0) {
          const found = await tx.service.count({ where: { id: { in: next } } });
          if (found !== next.length) throw new Abort("invalid_service");
        }
        const names = new Map(
          (
            await tx.service.findMany({
              where: { id: { in: [...next, ...current] } },
              select: { id: true, name: true },
            })
          ).map((s) => [s.id, s.name]),
        );
        const nameOf = (id: string) => names.get(id) ?? id;

        if (removed.length > 0) {
          await tx.incidentService.deleteMany({ where: { incidentId: incident.id, serviceId: { in: removed } } });
        }
        if (added.length > 0) {
          await tx.incidentService.createMany({
            data: added.map((serviceId) => ({ workspaceId: ctx.workspace.id, incidentId: incident.id, serviceId })),
          });
        }
        await event(tx, ctx, incident.id, "SERVICES_CHANGED", {
          from: current.map(nameOf),
          to: next.map(nameOf),
          added: added.map(nameOf),
          removed: removed.map(nameOf),
        });
        changed = true;
      }
    }

    if (Object.keys(data).length > 0) await tx.incident.update({ where: { id: incident.id }, data });
    return changed;
  });
}

/**
 * Moving to RESOLVED stamps `resolvedAt`; moving away from RESOLVED (reopening) clears it; moves
 * between open statuses leave it alone. Setting the status it already has is a no-op.
 */
export async function changeStatus(
  ctx: Ctx,
  number: number,
  status: StatusKey,
  now: Date = new Date(),
): Promise<Outcome> {
  return run(ctx, async (tx) => {
    const incident = await liveIncident(tx, number);
    if (incident.status === status) return false;

    await tx.incident.update({
      where: { id: incident.id },
      data: {
        status,
        ...(status === "RESOLVED" ? { resolvedAt: now } : incident.status === "RESOLVED" ? { resolvedAt: null } : {}),
      },
    });
    await event(tx, ctx, incident.id, "STATUS_CHANGED", { from: incident.status, to: status });
    await writeAudit(tx, ctx.workspace.id, {
      actorId: ctx.user.id,
      action: "incident.status_changed",
      targetType: "incident",
      targetId: incident.id,
      metadata: { number, from: incident.status, to: status },
    });
    return true;
  });
}

/**
 * Assign (`userId`), unassign (`null`) or leave alone (omitted) each role. Only members of this workspace
 * can hold a role, and each role has at most one holder.
 */
export async function setRoles(
  ctx: Ctx,
  number: number,
  roles: Partial<Record<RoleKey, string | null>>,
): Promise<Outcome> {
  return run(ctx, async (tx) => {
    const incident = await liveIncident(tx, number);

    const wanted = Object.values(roles).filter((v): v is string => typeof v === "string");
    const unique = [...new Set(wanted)];
    if (unique.length > 0 && (await tx.membership.count({ where: { userId: { in: unique } } })) !== unique.length) {
      throw new Abort("not_a_member");
    }

    let changed = false;
    for (const [role, userId] of Object.entries(roles) as [RoleKey, string | null | undefined][]) {
      if (userId === undefined) continue;
      const existing = await tx.incidentAssignment.findFirst({ where: { incidentId: incident.id, role } });
      if ((existing?.userId ?? null) === userId) continue;

      if (userId === null) {
        await tx.incidentAssignment.delete({ where: { id: existing!.id } });
        await event(tx, ctx, incident.id, "ROLE_UNASSIGNED", { role, from: existing!.userId, to: null });
      } else if (existing) {
        await tx.incidentAssignment.update({ where: { id: existing.id }, data: { userId } });
        await event(tx, ctx, incident.id, "ROLE_ASSIGNED", { role, from: existing.userId, to: userId });
      } else {
        await tx.incidentAssignment.create({
          data: { workspaceId: ctx.workspace.id, incidentId: incident.id, userId, role },
        });
        await event(tx, ctx, incident.id, "ROLE_ASSIGNED", { role, from: null, to: userId });
      }
      await writeAudit(tx, ctx.workspace.id, {
        actorId: ctx.user.id,
        action: "incident.role_changed",
        targetType: "incident",
        targetId: incident.id,
        metadata: { number, role, from: existing?.userId ?? null, to: userId },
      });
      changed = true;
    }
    return changed;
  });
}

/** Soft delete: the row stays (history, audit), and the scoped client hides it from then on. */
export async function deleteIncident(ctx: Ctx, number: number, now: Date = new Date()): Promise<Outcome> {
  return run(ctx, async (tx) => {
    const incident = await liveIncident(tx, number);
    await tx.incident.update({ where: { id: incident.id }, data: { deletedAt: now } });
    await event(tx, ctx, incident.id, "INCIDENT_DELETED", { number, title: incident.title });
    await writeAudit(tx, ctx.workspace.id, {
      actorId: ctx.user.id,
      action: "incident.deleted",
      targetType: "incident",
      targetId: incident.id,
      metadata: { number, title: incident.title },
    });
    return true;
  });
}
