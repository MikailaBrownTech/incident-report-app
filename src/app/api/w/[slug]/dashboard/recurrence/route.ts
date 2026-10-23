import { getRecurrenceStats } from "@/features/revenants/stats";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";
import { z } from "zod";

const query = z.object({
  from: z.iso.datetime({ offset: true, error: "invalid_date" }).optional(),
  to: z.iso.datetime({ offset: true, error: "invalid_date" }).optional(),
});

/** GET /api/w/{slug}/dashboard/recurrence?from=&to= (default: the last 90 days). The numbers behind the dashboard's recurrence tiles. */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/dashboard/recurrence">) => {
  const { slug } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    throw new ApiError(
      400,
      "validation_error",
      "Some parameters are invalid.",
      z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    );
  }
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - 90 * 86_400_000);
  if (from >= to) throw new ApiError(400, "validation_error", "`from` must be before `to`.", { from: ["after_to"] });
  return json(await getRecurrenceStats(ctx.db, { from, to }));
});
