import { memberError } from "@/features/workspaces/api-support";
import { changeMemberRole, removeMember } from "@/features/workspaces/members";
import { changeRoleBody } from "@/features/workspaces/schema";
import { handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/members/[userId]">;

/** PATCH /api/w/{slug}/members/{userId}: change a role (admins and owners; owner changes need an owner). */
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { slug, userId } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  requireRole(ctx, "ADMIN");
  const body = await readBody(request, changeRoleBody);

  const result = await changeMemberRole(ctx, userId, body.role);
  if (!result.ok) throw memberError(result.error);
  return json({ member: { userId, role: body.role } });
});

/** DELETE /api/w/{slug}/members/{userId}: remove someone, or leave (when userId is the caller). */
export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { slug, userId } = await params;
  const ctx = await getApiWorkspaceContext(slug);

  const result = await removeMember(ctx, userId);
  if (!result.ok) throw memberError(result.error);
  return json({ removed: true, left: result.left });
});
