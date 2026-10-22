import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { SkinKey } from "@/copy";
import type { Membership, Role, Skin, Workspace } from "@/generated/prisma/client";
import { ApiError } from "@/server/api/http";
import { getWorkspaceForMember } from "@/server/db/root";
import { scopedDb, type ScopedDb } from "@/server/db/tenant";
import { ForbiddenError, can, hasRole, type Action } from "./permissions";
import { getSession } from "./session";

export const toSkinKey = (s: Skin): SkinKey => (s === "HAUNTED" ? "haunted" : "professional");
export const toSkinEnum = (s: SkinKey): Skin => (s === "haunted" ? "HAUNTED" : "PROFESSIONAL");

export interface WorkspaceContext {
  user: { id: string; email: string; name: string };
  workspace: Workspace;
  membership: Membership;
  /** Every query in app code goes through this; it is locked to `workspace.id`. */
  db: ScopedDb;
  skin: SkinKey;
  can(action: Action): boolean;
  /** Throws ForbiddenError; call before mutating. */
  assert(action: Action): void;
}

export function buildContext(input: {
  workspace: Workspace;
  membership: Membership;
  user: WorkspaceContext["user"];
}): WorkspaceContext {
  const { workspace, membership, user } = input;
  return {
    user,
    workspace,
    membership,
    db: scopedDb(workspace.id),
    skin: toSkinKey(workspace.skin),
    can: (action) => can(membership.role, action),
    assert(action) {
      if (!can(membership.role, action)) throw new ForbiddenError(action);
    },
  };
}

/** Throws ForbiddenError (HTTP 403 in API routes) unless the caller holds at least `minimum`. */
export function requireRole(ctx: Pick<WorkspaceContext, "membership">, minimum: Role): void {
  if (!hasRole(ctx.membership.role, minimum)) throw new ForbiddenError(`requires ${minimum}`);
}

/** The signed-in user's membership of `slug`, or null (deduped per request). */
export const getMemberWorkspace = cache(async (slug: string) => {
  const session = await getSession();
  if (!session) return null;
  const found = await getWorkspaceForMember(slug, session.user.id);
  return found ? { ...found, user: session.user } : null;
});

function contextFrom(found: NonNullable<Awaited<ReturnType<typeof getMemberWorkspace>>>): WorkspaceContext {
  const { workspace, membership, user } = found;
  return buildContext({ workspace, membership, user: { id: user.id, email: user.email, name: user.name } });
}

/**
 * Entry point for every /app/{slug} PAGE, layout and server action. Not signed in goes to
 * sign-in with a callbackUrl; not a member (or no such workspace) is a 404, never a 403, so
 * slugs can't be enumerated.
 */
export const getWorkspaceContext = cache(async (slug: string): Promise<WorkspaceContext> => {
  if (!(await getSession())) redirect(`/sign-in?callbackUrl=${encodeURIComponent(`/app/${slug}`)}`);
  const found = await getMemberWorkspace(slug);
  if (!found) notFound();
  return contextFrom(found);
});

/** Same contract for API routes: throws ApiError 401 (no session) or 404 (not a member). */
export async function getApiWorkspaceContext(slug: string): Promise<WorkspaceContext> {
  if (!(await getSession())) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  const found = await getMemberWorkspace(slug);
  if (!found) throw new ApiError(404, "not_found", "Workspace not found.");
  return contextFrom(found);
}

/** Workspace skin for /app/<slug> routes; null if not signed in or not a member. */
export async function getWorkspaceSkin(slug: string): Promise<SkinKey | null> {
  const found = await getMemberWorkspace(slug);
  return found ? toSkinKey(found.workspace.skin) : null;
}
