import { parseIncidentNumber } from "@/features/incidents/api-support";
import { respond } from "@/features/postmortems/api-support";
import { publishPostmortem } from "@/features/postmortems/service";
import { handle } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/** POST: publish (any member). 422 missing_sections lists the required sections that are empty or too short. */
export const POST = handle(
  async (_request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/[number]/postmortem/publish">) => {
    const { slug, number } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    ctx.assert("incident.write");
    return respond(await publishPostmortem(ctx, parseIncidentNumber(number)));
  },
);
