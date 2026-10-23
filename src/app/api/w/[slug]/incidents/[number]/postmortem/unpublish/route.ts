import { parseIncidentNumber } from "@/features/incidents/api-support";
import { respond } from "@/features/postmortems/api-support";
import { unpublishPostmortem } from "@/features/postmortems/service";
import { handle } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

/** POST: unpublish back to a draft (admins and owners). */
export const POST = handle(
  async (_request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/[number]/postmortem/unpublish">) => {
    const { slug, number } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    requireRole(ctx, "ADMIN");
    return respond(await unpublishPostmortem(ctx, parseIncidentNumber(number)));
  },
);
