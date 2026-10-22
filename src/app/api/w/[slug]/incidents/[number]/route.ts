import { parseIncidentNumber, updateFailure } from "@/features/incidents/api-support";
import { getIncidentDetail } from "@/features/incidents/detail";
import { patchIncidentBody } from "@/features/incidents/schema";
import { deleteIncident, patchIncident } from "@/features/incidents/update";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/incidents/[number]">;

async function view(ctx: Awaited<ReturnType<typeof getApiWorkspaceContext>>, number: number) {
  const incident = await getIncidentDetail(ctx.db, number);
  if (!incident) throw new ApiError(404, "not_found", "Incident not found.");
  return json({ incident });
}

/** GET /api/w/{slug}/incidents/{number}: the incident with services and roles. 404 if missing, deleted or not yours. */
export const GET = handle(async (_request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  return view(ctx, parseIncidentNumber(number));
});

/** PATCH /api/w/{slug}/incidents/{number}: edit title, summary, severity and/or services (any member). */
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const n = parseIncidentNumber(number);
  const body = await readBody(request, patchIncidentBody);

  const result = await patchIncident(ctx, n, body);
  if (!result.ok) throw updateFailure(result.error);
  return view(ctx, n);
});

/** DELETE /api/w/{slug}/incidents/{number}: soft delete; admins and owners only. */
export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  requireRole(ctx, "ADMIN");

  const result = await deleteIncident(ctx, parseIncidentNumber(number));
  if (!result.ok) throw updateFailure(result.error);
  return json({ deleted: true });
});
