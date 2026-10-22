import { parseIncidentNumber } from "@/features/incidents/api-support";
import { noteFailure } from "@/features/timeline/api-support";
import { deleteNote, updateNote } from "@/features/timeline/notes";
import { resolvePeople } from "@/features/timeline/queries";
import { patchNoteBody } from "@/features/timeline/schema";
import { handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/incidents/[number]/events/[id]">;

/**
 * PATCH .../events/{id}: edit a note's text, time and/or key-moment flag. The author or an admin only; automatic
 * entries are immutable. An id from another incident or workspace is a 404.
 */
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { slug, number, id } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const n = parseIncidentNumber(number);
  const body = await readBody(request, patchNoteBody);

  const result = await updateNote(ctx, n, id, body);
  if (!result.ok) throw noteFailure(result.error);
  return json({ event: result.event, people: await resolvePeople([result.event]) });
});

/** DELETE .../events/{id}: permanently delete a note (author or admin), recording an audit row without its text. */
export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { slug, number, id } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const n = parseIncidentNumber(number);

  const result = await deleteNote(ctx, n, id);
  if (!result.ok) throw noteFailure(result.error);
  return json({ deleted: true });
});
