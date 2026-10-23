import { updateWorkspaceBody } from "@/features/workspaces/schema";
import { handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext, toSkinEnum, type WorkspaceContext } from "@/server/auth/context";

const view = (ctx: Pick<WorkspaceContext, "workspace" | "membership">) => ({
  workspace: {
    id: ctx.workspace.id,
    name: ctx.workspace.name,
    slug: ctx.workspace.slug,
    plan: ctx.workspace.plan,
    skin: ctx.workspace.skin === "HAUNTED" ? "haunted" : "professional",
  },
  membership: { role: ctx.membership.role },
});

/** GET /api/w/{slug}: the workspace and the caller's role. Non-members get 404. */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/w/[slug]">) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  return json(view(ctx));
});

/** PATCH /api/w/{slug}: rename (admins and owners) and/or switch skin (any member). */
export const PATCH = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]">) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  const body = await readBody(request, updateWorkspaceBody);

  if (body.name !== undefined) ctx.assert("workspace.rename");
  if (body.skin !== undefined) ctx.assert("skin.update");
  if (body.aiEnabled !== undefined) ctx.assert("workspace.rename"); // owners and admins

  const updated = await ctx.db.workspace.update({
    where: { id: ctx.workspace.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.skin !== undefined ? { skin: toSkinEnum(body.skin) } : {}),
      ...(body.aiEnabled !== undefined ? { aiEnabled: body.aiEnabled } : {}),
    },
  });
  return json(view({ workspace: updated, membership: ctx.membership }));
});
