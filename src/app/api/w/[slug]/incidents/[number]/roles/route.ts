import { parseIncidentNumber, updateFailure } from "@/features/incidents/api-support";
import { getIncidentDetail } from "@/features/incidents/detail";
import { rolesBody } from "@/features/incidents/schema";
import { setRoles } from "@/features/incidents/update";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/**
 * PUT /api/w/{slug}/incidents/{number}/roles: body `{ COMMANDER?, SCRIBE?, COMMS? }`, each a member's user id,
 * `null` to unassign, or omitted to leave alone. Non-members are rejected with 400.
 */
export const PUT = handle(
  async (request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/[number]/roles">) => {
    const { slug, number } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    ctx.assert("incident.write");
    const n = parseIncidentNumber(number);
    const roles = await readBody(request, rolesBody);

    const result = await setRoles(ctx, n, roles);
    if (!result.ok) throw updateFailure(result.error);
    const incident = await getIncidentDetail(ctx.db, n);
    if (!incident) throw new ApiError(404, "not_found", "Incident not found.");
    return json({ incident });
  },
);
