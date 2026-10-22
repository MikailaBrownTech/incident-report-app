import { createServiceBody } from "@/features/services/schema";
import { createService, listServices } from "@/features/services/service";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/services">;

/** GET /api/w/{slug}/services: every member can see the services (read-only for plain members). */
export const GET = handle(async (_request: Request, { params }: Context) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  return json({ services: await listServices(ctx.db) });
});

/** POST /api/w/{slug}/services: admins and owners create a service; the slug is generated from the name. */
export const POST = handle(async (request: Request, { params }: Context) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  requireRole(ctx, "ADMIN");
  const body = await readBody(request, createServiceBody);

  const result = await createService(ctx, body.name);
  if (!result.ok)
    throw new ApiError(409, "name_taken", "A service with that name already exists.", { name: ["name_taken"] });
  return json({ service: result.service }, 201);
});
