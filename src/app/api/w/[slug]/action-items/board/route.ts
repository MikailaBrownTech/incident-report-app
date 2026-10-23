import { parseListQuery } from "@/features/action-items/schema";
import { getBoard } from "@/features/action-items/service";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

/**
 * GET /api/w/{slug}/action-items/board
 * The four status columns, each ordered by position with a per-column `limit` (default 25) and `nextCursor`. Page one
 * column with `column=<status>&cursor=<its nextCursor>`. Same filters as the list, plus `all=1` to show Done and
 * Won't do from any date (default: the last 14 days).
 */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/action-items/board">) => {
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
  return json(await getBoard(ctx, parsed.params));
});
