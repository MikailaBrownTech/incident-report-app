import { checkSlug, type SlugProblem } from "@/features/workspaces/slug";
import { Prisma, type Role } from "@/generated/prisma/client";
import { hashInviteToken } from "@/server/invites/token";
import { prisma } from "./client";

/**
 * Deliberately UNSCOPED queries: the handful of operations that must run before a
 * workspace is known (resolving a slug for a user, creating a workspace, redeeming an
 * invite). Each takes the acting user explicitly. Keep this file small.
 */

export async function listWorkspacesForUser(userId: string) {
  const rows = await prisma.membership.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({ role: m.role, workspace: m.workspace }));
}

/** Returns null unless the user is a member; callers turn that into a 404. */
export async function getWorkspaceForMember(slug: string, userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, workspace: { slug } },
    include: { workspace: true },
  });
  if (!membership) return null;
  const { workspace, ...rest } = membership;
  return { workspace, membership: rest };
}

/** Section order of the system postmortem template; titles and prompts come from the copy dictionary. */
const DEFAULT_TEMPLATE_SECTIONS = [
  { key: "CAUSE", position: 0 },
  { key: "LAST_SIGHTING", position: 1 },
  { key: "WITNESSES", position: 2 },
  { key: "LEARNED", position: 3 },
];

export type CreateWorkspaceResult =
  | { ok: true; workspace: { id: string; name: string; slug: string } }
  | { ok: false; error: SlugProblem | "slug_taken" };

/**
 * One transaction: workspace (skin HAUNTED), OWNER membership, default system postmortem
 * template, default retro rule (severity >= 4, REQUIRED) and the workspace.created audit row.
 */
export async function createWorkspaceWithOwner(input: {
  userId: string;
  name: string;
  slug: string;
}): Promise<CreateWorkspaceResult> {
  const problem = checkSlug(input.slug);
  if (problem) return { ok: false, error: problem };

  try {
    const workspace = await prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name: input.name,
          slug: input.slug,
          skin: "HAUNTED",
          memberships: { create: { userId: input.userId, role: "OWNER" } },
          retroRule: { create: { minSeverity: 4, mode: "REQUIRED" } },
          postmortemTemplates: {
            create: { name: "Default", isSystem: true, sections: DEFAULT_TEMPLATE_SECTIONS },
          },
        },
        select: { id: true, name: true, slug: true },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: created.id,
          actorId: input.userId,
          action: "workspace.created",
          targetType: "workspace",
          targetId: created.id,
          metadata: { slug: created.slug },
        },
      });
      return created;
    });
    return { ok: true, workspace };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "slug_taken" };
    }
    throw err;
  }
}

export type InviteLookup =
  | {
      status: "ok";
      invite: { id: string; email: string; role: Role; workspaceId: string };
      workspace: { name: string; slug: string; skin: "HAUNTED" | "PROFESSIONAL" };
    }
  | { status: "not_found" | "expired" | "revoked" | "used" };

export async function findInviteByToken(rawToken: string): Promise<InviteLookup> {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(rawToken) },
    include: { workspace: { select: { name: true, slug: true, skin: true } } },
  });
  if (!invite) return { status: "not_found" };
  if (invite.revokedAt) return { status: "revoked" };
  if (invite.acceptedAt) return { status: "used" };
  if (invite.expiresAt.getTime() < Date.now()) return { status: "expired" };
  const { workspace, ...rest } = invite;
  return {
    status: "ok",
    invite: { id: rest.id, email: rest.email, role: rest.role, workspaceId: rest.workspaceId },
    workspace,
  };
}

export type AcceptResult =
  | { status: "accepted"; slug: string }
  | { status: "wrong_email" | "not_found" | "expired" | "revoked" | "used" };

/**
 * The signed-in user's verified email must match the invited address. Creates exactly one
 * membership (none if they already belong), marks the invite used and writes the audit row.
 */
export async function acceptInvite(input: {
  rawToken: string;
  userId: string;
  userEmail: string;
}): Promise<AcceptResult> {
  const found = await findInviteByToken(input.rawToken);
  if (found.status !== "ok") return { status: found.status };
  if (found.invite.email.toLowerCase() !== input.userEmail.toLowerCase()) {
    return { status: "wrong_email" };
  }
  const { workspaceId, id: inviteId, role } = found.invite;

  const won = await prisma.$transaction(async (tx) => {
    // Claim the invite atomically so a double click can't create two memberships.
    const claimed = await tx.invite.updateMany({
      where: { id: inviteId, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count === 0) return false;

    const existing = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: input.userId } },
    });
    // Already a member: keep their existing role, create no duplicate.
    if (!existing) {
      await tx.membership.create({ data: { workspaceId, userId: input.userId, role } });
    }
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorId: input.userId,
        action: "invite.accepted",
        targetType: "invite",
        targetId: inviteId,
        metadata: { role, alreadyMember: Boolean(existing) },
      },
    });
    return true;
  });
  if (!won) return { status: "used" };
  return { status: "accepted", slug: found.workspace.slug };
}

/**
 * Names for user ids that appear in one workspace's own data (event authors, role holders), including people who
 * have since left it. Unscoped on purpose (the auth tables aren't reachable from a scoped client), so callers must
 * only pass ids they read from that workspace.
 */
export async function usersByIds(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true, image: true } });
}
