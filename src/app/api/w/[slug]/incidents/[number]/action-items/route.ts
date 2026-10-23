import { parseIncidentNumber } from "@/features/incidents/api-support";
import { respond } from "@/features/action-items/api-support";
import { createItemBody } from "@/features/action-items/schema";
import { createItem } from "@/features/action-items/service";
import { handle, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/**
 * POST { title, description?, ownerId?, dueDate? }: add an action item to the incident's postmortem (draft or
 * published). Any member may. 409 `no_postmortem` if the incident has none yet; the owner defaults to the creator.
 */
export const POST = handle(
  async (request: Request, { params }: RouteContext<"/api/w/[slug]/incidents/[number]/action-items">) => {
    const { slug, number } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    ctx.assert("incident.write");
    const n = parseIncidentNumber(number);
    const body = await readBody(request, createItemBody);
    return respond(await createItem(ctx, n, body), 201);
  },
);
