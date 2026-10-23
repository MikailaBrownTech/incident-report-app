import { parseIncidentNumber } from "@/features/incidents/api-support";
import { dismissBody } from "@/features/revenants/api-support";
import { dismissCandidate } from "@/features/revenants/link";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/** POST { candidateNumber }: "not a match". Remembered, so the same suggestion doesn't come back. */
export const POST = handle(
  async (request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/[number]/revenant-dismiss">) => {
    const { slug, number } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    ctx.assert("incident.write");
    const n = parseIncidentNumber(number);
    const body = await readBody(request, dismissBody);
    const result = await dismissCandidate(ctx, n, body.candidateNumber);
    if (!result.ok) {
      throw result.error === "self"
        ? new ApiError(400, "validation_error", "An incident can't be dismissed against itself.", {
            candidateNumber: ["self"],
          })
        : new ApiError(404, "not_found", "Incident not found.");
    }
    return json({ dismissed: true });
  },
);
