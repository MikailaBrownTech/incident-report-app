import { listTemplates } from "@/features/postmortems/service";
import { handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/** GET /api/w/{slug}/postmortem-templates: the built-in templates, then this workspace's own. */
export const GET = handle(async (_request: Request, { params }: RouteContext<"/api/w/[slug]/postmortem-templates">) => {
  const { slug } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  return json({ templates: await listTemplates(ctx.db) });
});
