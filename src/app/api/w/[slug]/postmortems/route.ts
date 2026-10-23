import { listPostmortems } from "@/features/postmortems/list";
import { parseListQuery } from "@/features/postmortems/schema";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/**
 * GET /api/w/{slug}/postmortems
 *   state=REQUIRED,DUE_SOON,OVERDUE,DRAFT,PUBLISHED  severity=4,5  q=<title or number>  needsAttention=1
 *   sort=due|severity|number|published  dir=asc|desc  limit (1-100, default 25)  cursor
 * Existing postmortems plus resolved incidents that require one but have none.
 */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/postmortems">) => {
  const { slug } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  const raw: Record<string, string | string[]> = {};
  const search = new URL(request.url).searchParams;
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const parsed = parseListQuery(raw);
  if (!parsed.ok) throw new ApiError(400, "validation_error", "Some parameters are invalid.", parsed.fieldErrors);
  return json(await listPostmortems(ctx.db, parsed.params));
});
