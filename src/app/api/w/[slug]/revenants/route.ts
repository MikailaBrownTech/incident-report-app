import { searchParamsToRaw } from "@/features/revenants/api-support";
import { findSuspects, listChains, parseChainQuery } from "@/features/revenants/recurring";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/**
 * GET /api/w/{slug}/revenants
 *   service=id,id  minOccurrences=2|3|5  hasOpenRituals=1  q=<title or number>  sort=recent|occurrences|rituals
 *   limit (1-100, default 25)  cursor      -> { items, nextCursor }: one row per chain
 *   view=suspects                           -> { suspects }: strong, unlinked pairs (at most 20), computed on demand
 */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/revenants">) => {
  const { slug } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  const parsed = parseChainQuery(searchParamsToRaw(request));
  if (!parsed.ok) throw new ApiError(400, "validation_error", "Some parameters are invalid.", parsed.fieldErrors);
  if (parsed.params.view === "suspects") return json({ suspects: await findSuspects(ctx.db) });
  return json(await listChains(ctx.db, parsed.params));
});
