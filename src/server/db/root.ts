import { randomBytes } from "node:crypto";
import type { Role } from "@/generated/prisma/client";
import { hashInviteToken } from "@/server/invites/token";
import { prisma } from "./client";

/**
 * Deliberately UNSCOPED queries: the handful of operations that must run before a
 * workspace is known (resolving a slug for a user, creating a workspace, redeeming an
 * invite). Each takes the acting user explicitly. Keep this file small.
 */

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "crypt";
}

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

export async function createWorkspaceWithOwner(input: { userId: string; name: string }) {
  const base = slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    if (await prisma.workspace.findUnique({ where: { slug }, select: { id: true } })) continue;
    return prisma.workspace.create({
      data: {
        name: input.name,
        slug,
        retroRule: { create: {} },
        memberships: { create: { userId: input.userId, role: "OWNER" } },
      },
    });
  }
  throw new Error("Could not allocate a unique workspace slug");
}

export type InviteLookup =
  | { status: "ok"; invite: { id: string; email: string; role: Role; workspaceId: string }; workspace: { name: string; slug: string; skin: "HAUNTED" | "PROFESSIONAL" } }
  | { status: "not_found" | "expired" | "used" };

export async function findInviteByToken(rawToken: string): Promise<InviteLookup> {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(rawToken) },
    include: { workspace: { select: { name: true, slug: true, skin: true } } },
  });
  if (!invite) return { status: "not_found" };
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
  | { status: "wrong_email" | "not_found" | "expired" | "used" };

/** The signed-in user's verified email must match the invited address. */
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
  const won = await prisma.$transaction(async (tx) => {
    // Claim the invite atomically so a double click can't create two memberships.
    const claimed = await tx.invite.updateMany({
      where: { id: found.invite.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    await tx.membership.upsert({
      where: {
        workspaceId_userId: { workspaceId: found.invite.workspaceId, userId: input.userId },
      },
      create: {
        workspaceId: found.invite.workspaceId,
        userId: input.userId,
        role: found.invite.role,
      },
      update: {}, // already a member: keep their existing role
    });
    return true;
  });
  if (!won) return { status: "used" };
  return { status: "accepted", slug: found.workspace.slug };
}
