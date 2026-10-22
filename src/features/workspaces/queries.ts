import type { Role } from "@/generated/prisma/client";
import type { ScopedDb } from "@/server/db/tenant";

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  joinedAt: string;
}

export interface InviteView {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "expired";
}

export async function listMembers(db: ScopedDb): Promise<MemberView[]> {
  const rows = await db.membership.findMany({
    include: { user: { select: { name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role,
    joinedAt: m.createdAt.toISOString(),
  }));
}

/** Invites still awaiting an answer (accepted and revoked ones are history, not pending). */
export async function listPendingInvites(db: ScopedDb): Promise<InviteView[]> {
  const rows = await db.invite.findMany({
    where: { acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const now = Date.now();
  return rows.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    status: i.expiresAt.getTime() < now ? "expired" : "pending",
  }));
}
