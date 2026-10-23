import { parseIncidentNumber } from "@/features/incidents/api-support";
import { getAccountability, getChain } from "@/features/revenants/chains";
import { findRevenantCandidates } from "@/features/revenants/candidates";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/**
 * GET: this incident's chain (null when standalone), possible revenants (only while it is unlinked), and whether earlier
 * occurrences' lessons were acted on.
 */
export const GET = handle(
  async (_request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/[number]/revenants">) => {
    const { slug, number } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    const incident = await ctx.db.incident.findFirst({
      where: { number: parseIncidentNumber(number) },
      select: { id: true, title: true, startedAt: true, services: { select: { serviceId: true } } },
    });
    if (!incident) throw new ApiError(404, "not_found", "Incident not found.");

    const chain = await getChain(ctx.db, incident.id);
    const [candidates, accountability] = await Promise.all([
      chain
        ? Promise.resolve([])
        : findRevenantCandidates(ctx.db, {
            title: incident.title,
            serviceIds: incident.services.map((s) => s.serviceId),
            excludeIncidentId: incident.id,
            startedBefore: incident.startedAt,
            limit: 3,
            dismissedBy: ctx.user.id,
          }),
      chain ? getAccountability(ctx.db, chain, incident.id) : Promise.resolve(null),
    ]);
    return json({ chain, candidates, accountability });
  },
);
