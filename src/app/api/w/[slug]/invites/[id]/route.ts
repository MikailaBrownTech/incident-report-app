import { memberError } from "@/features/workspaces/api-support";
import { revokeInvite } from "@/features/workspaces/members";
import { handle, json } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

/** DELETE /api/w/{slug}/invites/{id}: revoke a pending invite; its link stops working. */
export const DELETE = handle(async (_request: Request, { params }: RouteContext<"/api/w/[slug]/invites/[id]">) => {
  const { slug, id } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  requireRole(ctx, "ADMIN");

  const result = await revokeInvite(ctx, id);
  if (!result.ok) throw memberError(result.error);
  return json({ revoked: true });
});
