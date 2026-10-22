import { parseIncidentNumber } from "@/features/incidents/api-support";
import { createNote } from "@/features/timeline/notes";
import { findLiveIncident, listChanges, listTimeline, resolvePeople } from "@/features/timeline/queries";
import { createNoteBody, timelineQuerySchema } from "@/features/timeline/schema";
import { noteFailure } from "@/features/timeline/api-support";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";
import { z } from "zod";

type Context = RouteContext<"/api/w/[slug]/incidents/[number]/events">;

/**
 * GET /api/w/{slug}/incidents/{number}/events
 *   filter  all | notes | status | roles | key          (default all)
 *   order   asc | desc                                  (default asc)
 *   limit   1-100                                       (default 50)
 *   cursor  from a previous response's nextCursor, to continue in the same order
 *   after   an `asOf` timestamp: instead of a page, returns what was created, edited or deleted since then
 */
export const GET = handle(async (request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  const n = parseIncidentNumber(number);

  const raw: Record<string, string | string[]> = {};
  const search = new URL(request.url).searchParams;
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const parsed = timelineQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "validation_error",
      "Some parameters are invalid.",
      z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    );
  }

  const incident = await findLiveIncident(ctx.db, n);
  if (!incident) throw new ApiError(404, "not_found", "Incident not found.");

  const q = parsed.data;
  if (q.after) return json(await listChanges(ctx.db, incident, q.after));
  return json(await listTimeline(ctx.db, incident.id, q));
});

/** POST /api/w/{slug}/incidents/{number}/events: add a note (any member), optionally backdated or starred. */
export const POST = handle(async (request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const n = parseIncidentNumber(number);
  const body = await readBody(request, createNoteBody);

  const result = await createNote(ctx, n, body);
  if (!result.ok) throw noteFailure(result.error);
  return json({ event: result.event, people: await resolvePeople([result.event]) }, 201);
});
