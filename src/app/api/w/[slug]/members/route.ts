import { listMembers } from "@/features/workspaces/queries";
import { handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/** GET /api/w/{slug}/members: every member can see who else is in the workspace. */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/w/[slug]/members">) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  return json({ members: await listMembers(ctx.db) });
});
