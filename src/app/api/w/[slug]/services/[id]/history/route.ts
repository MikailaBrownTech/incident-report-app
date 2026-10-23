import { getServiceHistory } from "@/features/services/history";
import { ApiError, handle, json } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";
import { z } from "zod";

const query = z.object({
  limit: z.coerce
    .number({ error: "invalid_limit" })
    .int("invalid_limit")
    .min(1, "invalid_limit")
    .max(100, "invalid_limit")
    .default(25),
  cursor: z.string().min(1).max(200).optional(),
});

/**
 * GET /api/w/{slug}/services/{serviceSlug}/history?limit=&cursor=
 * (The segment is named `id` because the folder is shared with the service CRUD routes; here it holds the service's slug.)
 * Incident history (newest first, paged), recurring issues touching the service, mean time to resolve, counts by severity.
 */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/services/[id]/history">) => {
  const { slug, id: serviceSlug } = await params;
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
  const history = await getServiceHistory(ctx.db, serviceSlug, {
    limit: parsed.data.limit,
    cursor: parsed.data.cursor ?? null,
  });
  if (!history) throw new ApiError(404, "not_found", "Service not found.");
  return json(history);
});
