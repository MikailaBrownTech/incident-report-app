import { updateServiceBody } from "@/features/services/schema";
import { deleteService, renameService } from "@/features/services/service";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/services/[id]">;

/** PATCH /api/w/{slug}/services/{id}: rename (the slug stays the same). */
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { slug, id } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  requireRole(ctx, "ADMIN");
  const body = await readBody(request, updateServiceBody);

  const result = await renameService(ctx, id, body.name);
  if (!result.ok) {
    if (result.error === "not_found") throw new ApiError(404, "not_found", "Service not found.");
    throw new ApiError(409, "name_taken", "A service with that name already exists.", { name: ["name_taken"] });
  }
  return json({ service: { id, name: body.name } });
});

/** DELETE /api/w/{slug}/services/{id}: removes the service and its incident links, never the incidents. */
export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { slug, id } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  requireRole(ctx, "ADMIN");

  const result = await deleteService(ctx, id);
  if (!result.ok) throw new ApiError(404, "not_found", "Service not found.");
  return json({ deleted: true, unlinkedIncidents: result.unlinkedIncidents });
});
