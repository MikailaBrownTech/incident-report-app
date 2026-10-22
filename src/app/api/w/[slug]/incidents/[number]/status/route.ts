import { parseIncidentNumber, updateFailure } from "@/features/incidents/api-support";
import { getIncidentDetail } from "@/features/incidents/detail";
import { statusBody } from "@/features/incidents/schema";
import { changeStatus } from "@/features/incidents/update";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/**
 * POST /api/w/{slug}/incidents/{number}/status: move to a status (any member). RESOLVED stamps resolvedAt,
 * leaving RESOLVED (reopening) clears it, and setting the current status is a no-op.
 */
export const POST = handle(
  async (request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/[number]/status">) => {
    const { slug, number } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    ctx.assert("incident.write");
    const n = parseIncidentNumber(number);
    const { status } = await readBody(request, statusBody);

    const result = await changeStatus(ctx, n, status);
    if (!result.ok) throw updateFailure(result.error);
    const incident = await getIncidentDetail(ctx.db, n);
    if (!incident) throw new ApiError(404, "not_found", "Incident not found.");
    return json({ incident, changed: result.changed });
  },
);
