import { z } from "zod";
import { serviceNameSchema } from "@/features/services/schema";
import { createServiceIn } from "@/features/services/service";
import { linkInTx } from "@/features/revenants/link";
import { writeAudit } from "@/server/audit";
import type { WorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";

export const OPEN_STATUSES = ["INVESTIGATING", "IDENTIFIED", "MITIGATING"] as const;
/** How far ahead of "now" a start time may be (clock skew between browser and server). */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export const declareIncidentBody = z.object({
  title: z.string().trim().min(1, "required").max(140, "too_long"),
  summary: z.string().trim().max(20_000, "too_long").default(""),
  severity: z.number().int("invalid").min(1, "invalid").max(5, "invalid"),
  serviceIds: z.array(z.string().min(1)).max(25).default([]),
  /** Admins and owners can create services while declaring. */
  newServiceNames: z.array(serviceNameSchema).max(10).default([]),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(OPEN_STATUSES).default("INVESTIGATING"),
  /** Declare it as a recurrence of this earlier incident (its chain's root is used). All or nothing. */
  revenantOfNumber: z.number().int().positive().optional(),
});
export type DeclareIncidentInput = z.output<typeof declareIncidentBody>;

export type DeclareError =
  | "forbidden"
  | "invalid_service"
  | "name_taken"
  | "started_in_future"
  | "revenant_not_found"
  | "revenant_not_earlier";

type Ctx = Pick<WorkspaceContext, "db" | "workspace" | "membership" | "user">;

/** Thrown inside the transaction so everything done so far rolls back. */
class Abort extends Error {
  constructor(readonly reason: DeclareError) {
    super(reason);
  }
}

/**
 * One transaction: allocate the number, create the incident with its service links, write
 * the system timeline event and the audit row. The creator is recorded as `createdById`
 * and gets no incident role.
 */
export async function declareIncident(
  ctx: Ctx,
  input: DeclareIncidentInput,
  now: Date = new Date(),
): Promise<{ ok: true; incident: { id: string; number: number } } | { ok: false; error: DeclareError }> {
  const startedAt = input.startedAt ? new Date(input.startedAt) : now;
  if (startedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) return { ok: false, error: "started_in_future" };

  const newNames = [...new Set(input.newServiceNames)];
  if (newNames.length > 0 && !hasRole(ctx.membership.role, "ADMIN")) return { ok: false, error: "forbidden" };
  const existingIds = [...new Set(input.serviceIds)];

  try {
    return await ctx.db.$transaction(async (tx) => {
      if (existingIds.length > 0) {
        const found = await tx.service.count({
          where: { id: { in: existingIds } },
        });
        if (found !== existingIds.length) throw new Abort("invalid_service");
      }
      const createdIds: string[] = [];
      for (const name of newNames) {
        const created = await createServiceIn(tx, ctx.workspace.id, name);
        if (!created.ok) throw new Abort("name_taken"); // rolls back services created earlier in this loop
        createdIds.push(created.service.id);
      }

      // Atomic: Prisma issues a single `UPDATE ... SET n = n + 1 ... RETURNING n`, which takes the
      // row lock, so concurrent declarations get distinct numbers. Never max(number) + 1.
      const { nextIncidentNumber } = await tx.workspace.update({
        where: { id: ctx.workspace.id },
        data: { nextIncidentNumber: { increment: 1 } },
        select: { nextIncidentNumber: true },
      });
      const number = nextIncidentNumber - 1;

      const incident = await tx.incident.create({
        data: {
          workspaceId: ctx.workspace.id,
          number,
          title: input.title,
          summary: input.summary,
          severity: input.severity,
          status: input.status,
          startedAt,
          createdById: ctx.user.id,
          services: {
            create: [...existingIds, ...createdIds].map((serviceId) => ({
              serviceId,
            })),
          },
        },
        select: { id: true, number: true, title: true, startedAt: true, revenantOfId: true },
      });

      if (input.revenantOfNumber !== undefined) {
        const linked = await linkInTx(tx, ctx, incident, input.revenantOfNumber);
        // a bad target fails the whole request: nothing is created
        if (!linked.ok) throw new Abort(linked.error === "not_found" ? "revenant_not_found" : "revenant_not_earlier");
      }

      await tx.event.create({
        data: {
          workspaceId: ctx.workspace.id,
          incidentId: incident.id,
          type: "STATUS_CHANGED",
          source: "SYSTEM",
          actorId: ctx.user.id,
          payload: { to: input.status, created: true },
          occurredAt: startedAt,
        },
      });
      await writeAudit(tx, ctx.workspace.id, {
        actorId: ctx.user.id,
        action: "incident.created",
        targetType: "incident",
        targetId: incident.id,
        metadata: { number, severity: input.severity, status: input.status },
      });
      return { ok: true as const, incident: { id: incident.id, number: incident.number } };
    });
  } catch (err) {
    if (err instanceof Abort) return { ok: false, error: err.reason };
    throw err;
  }
}
