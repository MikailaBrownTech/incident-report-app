import { parseListQuery } from "@/features/action-items/schema";
import { listItems } from "@/features/action-items/service";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

const queryOf = (request: Request) => {
  const raw: Record<string, string | string[]> = {};
  const search = new URL(request.url).searchParams;
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  return raw;
};

/**
 * GET /api/w/{slug}/action-items
 *   owner=me|any|<userId>  status=OPEN,IN_PROGRESS,...  overdue=1  dueThisWeek=1  incident=<number>  q=<text>
 *   sort=due|created|title  limit (1-100, default 25)  cursor
 */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/action-items">) => {
  const { slug } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  const parsed = parseListQuery(queryOf(request));
  if (!parsed.ok) throw new ApiError(400, "validation_error", "Some parameters are invalid.", parsed.fieldErrors);
  return json(await listItems(ctx, parsed.params));
});
