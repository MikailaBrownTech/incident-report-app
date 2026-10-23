import { writeAudit } from "@/server/audit";
import type { WorkspaceContext } from "@/server/auth/context";
import { lockWorkspace } from "@/server/db/lock";
import type { ScopedDb } from "@/server/db/tenant";

type Ctx = Pick<WorkspaceContext, "db" | "workspace" | "user">;
type Tx = Pick<ScopedDb, "incident" | "event" | "auditLog" | "revenantDismissal">;

export type LinkError = "not_found" | "self" | "target_not_earlier" | "cycle";
export type UnlinkError = "not_found" | "not_linked" | "is_root";
export type LinkResult =
  { ok: true; noop: boolean; root: { id: string; number: number; title: string } } | { ok: false; error: LinkError };
export type UnlinkResult = { ok: true; root: { id: string; number: number } } | { ok: false; error: UnlinkError };

const SELECT = { id: true, number: true, title: true, startedAt: true, revenantOfId: true } as const;

/**
 * Link `incident` as a recurrence of `targetNumber`, inside the caller's transaction (the caller holds the workspace lock).
 *
 * Chains stay one level deep: a target that is itself a revenant resolves to its root. If `incident` is the root of
 * chain of its own, that whole group moves under the new root; if it already belongs to another chain, only it moves.
 */
export async function linkInTx(
  tx: Tx,
  ctx: Pick<Ctx, "workspace" | "user">,
  incident: { id: string; number: number; title: string; startedAt: Date; revenantOfId: string | null },
  targetNumber: number,
): Promise<LinkResult> {
  const target = await tx.incident.findFirst({ where: { number: targetNumber }, select: SELECT });
  if (!target) return { ok: false, error: "not_found" };
  if (target.id === incident.id) return { ok: false, error: "self" };
  // the later incident links to the earlier one, never the other way round
  if (target.startedAt.getTime() >= incident.startedAt.getTime()) return { ok: false, error: "target_not_earlier" };

  const root = target.revenantOfId
    ? ((await tx.incident.findFirst({ where: { id: target.revenantOfId }, select: SELECT })) ?? target)
    : target;
  // the target is one of this incident's own revenants: linking would make a root point at its own revenant
  if (root.id === incident.id) return { ok: false, error: "cycle" };
  const rootInfo = { id: root.id, number: root.number, title: root.title };
  if (incident.revenantOfId === root.id) return { ok: true, noop: true, root: rootInfo };

  // an incident that is the root of its own chain brings its revenants with it
  const moved = await tx.incident.updateMany({
    where: { revenantOfId: incident.id },
    data: { revenantOfId: root.id },
  });
  await tx.incident.update({ where: { id: incident.id }, data: { revenantOfId: root.id } });

  const label = (n: number) => n;
  await tx.event.create({
    data: {
      workspaceId: ctx.workspace.id,
      incidentId: incident.id,
      type: "REVENANT_LINKED",
      source: "USER",
      actorId: ctx.user.id,
      payload: { role: "revenant", rootNumber: label(root.number), rootTitle: root.title },
    },
  });
  await tx.event.create({
    data: {
      workspaceId: ctx.workspace.id,
      incidentId: root.id,
      type: "REVENANT_LINKED",
      source: "USER",
      actorId: ctx.user.id,
      payload: { role: "root", revenantNumber: incident.number, revenantTitle: incident.title },
    },
  });
  await writeAudit(tx, ctx.workspace.id, {
    actorId: ctx.user.id,
    action: "incident.revenant_linked",
    targetType: "incident",
    targetId: incident.id,
    metadata: { number: incident.number, rootNumber: root.number, movedRevenants: moved.count },
  });
  return { ok: true, noop: false, root: rootInfo };
}

/** Any member can link. One transaction, serialised per workspace, so two links at once can't make a cycle. */
export async function linkRevenant(ctx: Ctx, incidentNumber: number, targetNumber: number): Promise<LinkResult> {
  return ctx.db.$transaction(async (tx) => {
    await lockWorkspace(tx, ctx.workspace.id);
    const incident = await tx.incident.findFirst({ where: { number: incidentNumber }, select: SELECT });
    if (!incident) return { ok: false as const, error: "not_found" as const };
    return linkInTx(tx, ctx, incident, targetNumber);
  });
}

/** Makes a revenant a standalone incident again. A root has nothing to unlink from. */
export async function unlinkRevenant(ctx: Ctx, incidentNumber: number): Promise<UnlinkResult> {
  return ctx.db.$transaction(async (tx) => {
    await lockWorkspace(tx, ctx.workspace.id);
    const incident = await tx.incident.findFirst({ where: { number: incidentNumber }, select: SELECT });
    if (!incident) return { ok: false as const, error: "not_found" as const };
    if (!incident.revenantOfId) {
      const hasRevenants = await tx.incident.count({ where: { revenantOfId: incident.id } });
      return { ok: false as const, error: hasRevenants > 0 ? ("is_root" as const) : ("not_linked" as const) };
    }
    const root = await tx.incident.findFirst({ where: { id: incident.revenantOfId }, select: SELECT });
    await tx.incident.update({ where: { id: incident.id }, data: { revenantOfId: null } });
    const event = (incidentId: string, payload: Record<string, unknown>) =>
      tx.event.create({
        data: {
          workspaceId: ctx.workspace.id,
          incidentId,
          type: "REVENANT_UNLINKED",
          source: "USER",
          actorId: ctx.user.id,
          payload: payload as never,
        },
      });
    await event(incident.id, { role: "revenant", rootNumber: root?.number ?? null, rootTitle: root?.title ?? null });
    if (root) await event(root.id, { role: "root", revenantNumber: incident.number, revenantTitle: incident.title });
    await writeAudit(tx, ctx.workspace.id, {
      actorId: ctx.user.id,
      action: "incident.revenant_unlinked",
      targetType: "incident",
      targetId: incident.id,
      metadata: { number: incident.number, rootNumber: root?.number ?? null },
    });
    return { ok: true as const, root: { id: root?.id ?? "", number: root?.number ?? 0 } };
  });
}

/** "Not a match": remember it for this person so the same suggestion stops coming back. */
export async function dismissCandidate(
  ctx: Ctx,
  incidentNumber: number,
  candidateNumber: number,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "self" }> {
  const [incident, candidate] = await Promise.all([
    ctx.db.incident.findFirst({ where: { number: incidentNumber }, select: { id: true } }),
    ctx.db.incident.findFirst({ where: { number: candidateNumber }, select: { id: true } }),
  ]);
  if (!incident || !candidate) return { ok: false, error: "not_found" };
  if (incident.id === candidate.id) return { ok: false, error: "self" };
  await ctx.db.revenantDismissal.upsert({
    where: { incidentId_candidateId: { incidentId: incident.id, candidateId: candidate.id } },
    create: {
      workspaceId: ctx.workspace.id,
      incidentId: incident.id,
      candidateId: candidate.id,
      dismissedById: ctx.user.id,
    },
    update: { dismissedById: ctx.user.id },
  });
  return { ok: true };
}
