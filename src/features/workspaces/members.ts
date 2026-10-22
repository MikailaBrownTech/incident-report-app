import type { Role } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import type { WorkspaceContext } from "@/server/auth/context";
import { canAssignRole, canRemoveMember } from "@/server/auth/permissions";
import { INVITE_TTL_MS, newInviteToken } from "@/server/invites/token";

export type MemberError = "forbidden" | "not_found" | "already_member" | "last_owner" | "has_rituals";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: MemberError };

type Ctx = Pick<WorkspaceContext, "db" | "workspace" | "membership" | "user">;
type Db = Ctx["db"];

/** Roles that can be granted by invitation (owners are only ever made by promotion). */
export type InviteRole = Extract<Role, "ADMIN" | "MEMBER">;

const ownerCount = (db: Pick<Db, "membership">) => db.membership.count({ where: { role: "OWNER" } });
const expiry = () => new Date(Date.now() + INVITE_TTL_MS);

export async function inviteMember(
  ctx: Ctx,
  input: { email: string; role: InviteRole },
): Promise<Result<{ token: string; inviteId: string }>> {
  if (!canAssignRole(ctx.membership.role, "MEMBER", input.role)) return { ok: false, error: "forbidden" };

  const existing = await ctx.db.membership.findFirst({ where: { user: { email: input.email } } });
  if (existing) return { ok: false, error: "already_member" };

  const { token, tokenHash } = newInviteToken();
  const invite = await ctx.db.$transaction(async (tx) => {
    // One live invite per address: re-inviting revokes the earlier link.
    await tx.invite.updateMany({
      where: { email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.invite.create({
      data: {
        workspaceId: ctx.workspace.id,
        email: input.email,
        role: input.role,
        tokenHash,
        invitedById: ctx.user.id,
        expiresAt: expiry(),
      },
    });
    await writeAudit(tx, ctx.workspace.id, {
      actorId: ctx.user.id,
      action: "invite.created",
      targetType: "invite",
      targetId: created.id,
      metadata: { email: input.email, role: input.role },
    });
    return created;
  });
  return { ok: true, token, inviteId: invite.id };
}

export async function revokeInvite(ctx: Ctx, inviteId: string): Promise<Result> {
  if (!canAssignRole(ctx.membership.role, "MEMBER", "MEMBER")) return { ok: false, error: "forbidden" };
  return ctx.db.$transaction(async (tx): Promise<Result> => {
    const invite = await tx.invite.findFirst({ where: { id: inviteId, acceptedAt: null, revokedAt: null } });
    if (!invite) return { ok: false, error: "not_found" };
    await tx.invite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctx.workspace.id, {
      actorId: ctx.user.id,
      action: "invite.revoked",
      targetType: "invite",
      targetId: invite.id,
      metadata: { email: invite.email },
    });
    return { ok: true };
  });
}

/** New token and a fresh 7 days for a pending (or expired) invite; the old link stops working. */
export async function resendInvite(
  ctx: Ctx,
  inviteId: string,
): Promise<Result<{ token: string; email: string; role: Role }>> {
  if (!canAssignRole(ctx.membership.role, "MEMBER", "MEMBER")) return { ok: false, error: "forbidden" };
  const { token, tokenHash } = newInviteToken();
  return ctx.db.$transaction(async (tx): Promise<Result<{ token: string; email: string; role: Role }>> => {
    const invite = await tx.invite.findFirst({ where: { id: inviteId, acceptedAt: null, revokedAt: null } });
    if (!invite) return { ok: false, error: "not_found" };
    await tx.invite.update({ where: { id: invite.id }, data: { tokenHash, expiresAt: expiry() } });
    await writeAudit(tx, ctx.workspace.id, {
      actorId: ctx.user.id,
      action: "invite.resent",
      targetType: "invite",
      targetId: invite.id,
      metadata: { email: invite.email },
    });
    return { ok: true, token, email: invite.email, role: invite.role };
  });
}

export async function changeMemberRole(ctx: Ctx, userId: string, next: Role): Promise<Result> {
  return ctx.db.$transaction(
    async (tx): Promise<Result> => {
      const target = await tx.membership.findFirst({ where: { userId } });
      if (!target) return { ok: false, error: "not_found" };
      if (!canAssignRole(ctx.membership.role, target.role, next)) return { ok: false, error: "forbidden" };
      if (target.role === next) return { ok: true };
      if (target.role === "OWNER" && (await ownerCount(tx)) <= 1) return { ok: false, error: "last_owner" };
      await tx.membership.update({ where: { id: target.id }, data: { role: next } });
      await writeAudit(tx, ctx.workspace.id, {
        actorId: ctx.user.id,
        action: "member.role_changed",
        targetType: "member",
        targetId: userId,
        metadata: { from: target.role, to: next },
      });
      return { ok: true };
    },
    // Serializable so two owners can't demote each other at the same instant.
    { isolationLevel: "Serializable" },
  );
}

/** Removes a member, or lets someone leave (userId === the caller). */
export async function removeMember(ctx: Ctx, userId: string): Promise<Result<{ left: boolean }>> {
  return ctx.db.$transaction(
    async (tx): Promise<Result<{ left: boolean }>> => {
      const target = await tx.membership.findFirst({ where: { userId } });
      if (!target) return { ok: false, error: "not_found" };
      const left = userId === ctx.user.id;
      if (!left && !canRemoveMember(ctx.membership.role, target.role)) return { ok: false, error: "forbidden" };
      if (target.role === "OWNER" && (await ownerCount(tx)) <= 1) return { ok: false, error: "last_owner" };
      if (await tx.actionItem.count({ where: { ownerId: userId, status: { not: "DONE" } } })) {
        return { ok: false, error: "has_rituals" };
      }
      await tx.membership.delete({ where: { id: target.id } });
      await writeAudit(tx, ctx.workspace.id, {
        actorId: ctx.user.id,
        action: "member.removed",
        targetType: "member",
        targetId: userId,
        metadata: { left, role: target.role },
      });
      return { ok: true, left };
    },
    { isolationLevel: "Serializable" },
  );
}
