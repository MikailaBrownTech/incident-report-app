import { createWorkspaceBody } from "@/features/workspaces/schema";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getSession } from "@/server/auth/session";
import { createWorkspaceWithOwner } from "@/server/db/root";

/** POST /api/workspaces: create a workspace; the caller becomes its OWNER. */
export const POST = handle(async (request: Request) => {
  const session = await getSession();
  if (!session) throw new ApiError(401, "unauthenticated", "Sign in to continue.");

  const body = await readBody(request, createWorkspaceBody);
  const result = await createWorkspaceWithOwner({ userId: session.user.id, name: body.name, slug: body.slug });
  if (!result.ok) {
    throw new ApiError(409, result.error, "That URL is not available.", { slug: [result.error] });
  }
  return json({ workspace: result.workspace }, 201);
});
