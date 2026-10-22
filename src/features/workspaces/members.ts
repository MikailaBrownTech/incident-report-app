import type { Role } from "@/generated/prisma/client";
import type { WorkspaceContext } from "@/server/auth/context";
import { canAssignRole, canRemoveMember } from "@/server/auth/permissions";
import { INVITE_TTL_MS, newInviteToken } from "@/server/invites/token";

export type MemberError = "forbidden" | "not_found" | "already_member" | "last_owner" | "has_rituals";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: MemberError };

type Ctx = Pick<WorkspaceContext, "db" | "workspace" | "membership" | "user">;
type Db = Ctx["db"];

const ownerCount = (db: Pick<Db, "membership">) => db.membership.count({ where: { role: "OWNER" } });

export async function inviteMember(ctx: Ctx, input: { email: string; role: Role }): Promise<Result<{ token: string }>> {
  if (!canAssignRole(ctx.membership.role, "MEMBER", input.role)) return { ok: false, error: "forbidden" };

  const existing = await ctx.db.membership.findFirst({ where: { user: { email: input.email } } });
  if (existing) return { ok: false, error: "already_member" };

  const { token, tokenHash } = newInviteToken();
  await ctx.db.$transaction(async (tx) => {
    // One live invite per address: re-inviting replaces the previous link.
    await tx.invite.deleteMany({ where: { email: input.email, acceptedAt: null } });
    await tx.invite.create({
      data: {
        workspaceId: ctx.db.$workspaceId,
        email: input.email,
        role: input.role,
        tokenHash,
        invitedById: ctx.user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  });
  return { ok: true, token };
}

export async function revokeInvite(ctx: Ctx, inviteId: string): Promise<Result> {
  if (!canAssignRole(ctx.membership.role, "MEMBER", "MEMBER")) return { ok: false, error: "forbidden" };
  const { count } = await ctx.db.invite.deleteMany({ where: { id: inviteId, acceptedAt: null } });
  return count ? { ok: true } : { ok: false, error: "not_found" };
}

export async function changeMemberRole(ctx: Ctx, userId: string, next: Role): Promise<Result> {
  return ctx.db.$transaction(
    async (tx): Promise<Result> => {
      const target = await tx.membership.findFirst({ where: { userId } });
      if (!target) return { ok: false, error: "not_found" };
      if (!canAssignRole(ctx.membership.role, target.role, next)) return { ok: false, error: "forbidden" };
      if (target.role === "OWNER" && next !== "OWNER" && (await ownerCount(tx)) <= 1) {
        return { ok: false, error: "last_owner" };
      }
      await tx.membership.update({ where: { id: target.id }, data: { role: next } });
      return { ok: true };
    },
    // Serializable so two owners can't demote each other at the same instant.
    { isolationLevel: "Serializable" },
  );
}

export async function removeMember(ctx: Ctx, userId: string): Promise<Result> {
  return ctx.db.$transaction(
    async (tx): Promise<Result> => {
      const target = await tx.membership.findFirst({ where: { userId } });
      if (!target) return { ok: false, error: "not_found" };
      const leaving = userId === ctx.user.id;
      if (!leaving && !canRemoveMember(ctx.membership.role, target.role)) return { ok: false, error: "forbidden" };
      if (target.role === "OWNER" && (await ownerCount(tx)) <= 1) return { ok: false, error: "last_owner" };
      if (await tx.actionItem.count({ where: { ownerId: userId, status: { not: "DONE" } } })) {
        return { ok: false, error: "has_rituals" };
      }
      await tx.membership.delete({ where: { id: target.id } });
      return { ok: true };
    },
    { isolationLevel: "Serializable" },
  );
}
