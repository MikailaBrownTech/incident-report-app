import { itemFailure, respond } from "@/features/action-items/api-support";
import { patchItemBody } from "@/features/action-items/schema";
import { deleteItem, getItem, updateItem } from "@/features/action-items/service";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/action-items/[id]">;

/** GET: one item. An id from another workspace is a 404. */
export const GET = handle(async (_request: Request, { params }: Context) => {
  const { slug, id } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  const found = await getItem(ctx, id);
  if (!found) throw new ApiError(404, "not_found", "Not found.");
  return json(found);
});

/**
 * PATCH: edit fields, reassign, change status, or move. Owner or admin only. A status change may carry `afterId` /
 * `beforeId` (the cards it was dropped between), and moving to WONT_DO needs `wontDoReason`.
 */
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { slug, id } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const body = await readBody(request, patchItemBody);
  return respond(await updateItem(ctx, id, body));
});

/** DELETE: admins and owners. */
export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { slug, id } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  requireRole(ctx, "ADMIN");
  const result = await deleteItem(ctx, id);
  if (!result.ok) throw itemFailure(result.error);
  return json({ deleted: true });
});
