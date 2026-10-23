import { parseIncidentNumber } from "@/features/incidents/api-support";
import { getTimelineSnapshot } from "@/features/postmortems/service";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/** GET: a fresh snapshot of the incident's key moments (or status changes) as a rich-text list, for "Refresh from timeline". */
export const GET = handle(
  async (_request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/[number]/postmortem/timeline">) => {
    const { slug, number } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    const doc = await getTimelineSnapshot(ctx, parseIncidentNumber(number));
    if (!doc) throw new ApiError(404, "not_found", "Incident not found.");
    return json({ doc });
  },
);
