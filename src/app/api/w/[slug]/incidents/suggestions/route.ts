import { searchParamsToRaw, suggestionsQuery, validationError } from "@/features/revenants/api-support";
import { findRevenantCandidates } from "@/features/revenants/candidates";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/**
 * GET /api/w/{slug}/incidents/suggestions?title=&services=id1,id2&excludeNumber=&startedBefore=&limit=
 * Earlier incidents that look like the same trouble coming back, best first. Nothing is ever linked automatically.
 */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/suggestions">) => {
  const { slug } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  const parsed = suggestionsQuery.safeParse(searchParamsToRaw(request));
  if (!parsed.success) throw validationError(parsed.error);
  const q = parsed.data;

  let excludeIncidentId: string | undefined;
  if (q.excludeNumber !== undefined) {
    const self = await ctx.db.incident.findFirst({ where: { number: q.excludeNumber }, select: { id: true } });
    if (!self) throw new ApiError(404, "not_found", "Incident not found.");
    excludeIncidentId = self.id;
  }
  // only this workspace's services count; an id from elsewhere is ignored
  const services = q.services.length
    ? await ctx.db.service.findMany({ where: { id: { in: q.services } }, select: { id: true } })
    : [];
  const candidates = await findRevenantCandidates(ctx.db, {
    title: q.title,
    serviceIds: services.map((s) => s.id),
    excludeIncidentId,
    startedBefore: q.startedBefore ? new Date(q.startedBefore) : undefined,
    limit: q.limit,
    dismissedBy: ctx.user.id,
  });
  return json({ candidates });
});
