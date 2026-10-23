import { parseIncidentNumber } from "@/features/incidents/api-support";
import { respond } from "@/features/postmortems/api-support";
import { createPostmortemBody, patchPostmortemBody } from "@/features/postmortems/schema";
import { createPostmortem, getPostmortem, savePostmortem } from "@/features/postmortems/service";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/incidents/[number]/postmortem">;

/** GET: the postmortem with its template and people; 404 if the incident has none yet. */
export const GET = handle(async (_request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  const payload = await getPostmortem(ctx, parseIncidentNumber(number));
  if (!payload) throw new ApiError(404, "not_found", "Not found.");
  return json(payload);
});

/** POST { templateId? }: start an autopsy (any member). 409 postmortem_exists if the incident already has one. */
export const POST = handle(async (request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const n = parseIncidentNumber(number);
  const body = await readBody(request, createPostmortemBody);
  return respond(await createPostmortem(ctx, n, body), 201);
});

/** PATCH { version, sections }: autosave. 409 version_conflict (with `latest`) if the version is stale. */
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const n = parseIncidentNumber(number);
  const body = await readBody(request, patchPostmortemBody);
  return respond(await savePostmortem(ctx, n, body));
});
