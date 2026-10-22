import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { SkinKey } from "@/copy";
import type { Membership, Skin, Workspace } from "@/generated/prisma/client";
import { getWorkspaceForMember } from "@/server/db/root";
import { forWorkspace, type ScopedDb } from "@/server/db/tenant";
import { ForbiddenError, can, type Action } from "./permissions";
import { getSession } from "./session";

export const toSkinKey = (s: Skin): SkinKey => (s === "HAUNTED" ? "haunted" : "professional");
export const toSkinEnum = (s: SkinKey): Skin => (s === "haunted" ? "HAUNTED" : "PROFESSIONAL");

export interface WorkspaceContext {
  /** Every query in app code goes through this; it is locked to `workspace.id`. */
  db: ScopedDb;
  workspace: Workspace;
  membership: Membership;
  user: { id: string; email: string; name: string };
  skin: SkinKey;
  can(action: Action): boolean;
  /** Throws ForbiddenError; server actions should call this before mutating. */
  assert(action: Action): void;
}

export function buildContext(input: {
  workspace: Workspace;
  membership: Membership;
  user: WorkspaceContext["user"];
}): WorkspaceContext {
  const { workspace, membership, user } = input;
  return {
    db: forWorkspace(workspace.id),
    workspace,
    membership,
    user,
    skin: toSkinKey(workspace.skin),
    can: (action) => can(membership.role, action),
    assert(action) {
      if (!can(membership.role, action)) throw new ForbiddenError(action);
    },
  };
}

/** The signed-in user's membership of `slug`, or null (deduped per request). */
export const getMemberWorkspace = cache(async (slug: string) => {
  const session = await getSession();
  if (!session) return null;
  const found = await getWorkspaceForMember(slug, session.user.id);
  return found ? { ...found, user: session.user } : null;
});

/**
 * Entry point for every workspace page, layout and server action. Not signed in goes to
 * login; not a member (or no such workspace) is a 404, so slugs can't be enumerated.
 */
export const requireWorkspace = cache(async (slug: string): Promise<WorkspaceContext> => {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/w/${slug}`)}`);
  const found = await getMemberWorkspace(slug);
  if (!found) notFound();
  const { workspace, membership, user } = found;
  return buildContext({
    workspace,
    membership,
    user: { id: user.id, email: user.email, name: user.name },
  });
});

/** Workspace skin for /w/<slug> routes; null if not signed in or not a member. */
export async function getWorkspaceSkin(slug: string): Promise<SkinKey | null> {
  const found = await getMemberWorkspace(slug);
  return found ? toSkinKey(found.workspace.skin) : null;
}
