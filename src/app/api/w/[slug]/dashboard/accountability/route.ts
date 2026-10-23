import { getAccountabilitySummary } from "@/features/revenants/stats";
import { handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/** GET /api/w/{slug}/dashboard/accountability: what needs attention across action items and postmortems. */
export const GET = handle(
  async (_request: Request, { params }: RouteContext<"/api/w/[slug]/dashboard/accountability">) => {
    const { slug } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    return json(await getAccountabilitySummary(ctx.db));
  },
);
