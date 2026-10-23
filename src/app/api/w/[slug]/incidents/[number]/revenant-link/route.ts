import { parseIncidentNumber } from "@/features/incidents/api-support";
import { linkBody, linkFailure, unlinkFailure } from "@/features/revenants/api-support";
import { linkRevenant, unlinkRevenant } from "@/features/revenants/link";
import { handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/incidents/[number]/revenant-link">;

/** POST { revenantOfNumber }: record this incident as a recurrence of an earlier one (any member). */
export const POST = handle(async (request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const n = parseIncidentNumber(number);
  const body = await readBody(request, linkBody);
  const result = await linkRevenant(ctx, n, body.revenantOfNumber);
  if (!result.ok) throw linkFailure(result.error);
  return json({ linked: true, noop: result.noop, root: result.root });
});

/** DELETE: make a recurrence a standalone incident again. */
export const DELETE = handle(async (_request: Request, { params }: Context) => {
  const { slug, number } = await params;
  const ctx = await getApiWorkspaceContext(slug);
  ctx.assert("incident.write");
  const result = await unlinkRevenant(ctx, parseIncidentNumber(number));
  if (!result.ok) throw unlinkFailure(result.error);
  return json({ unlinked: true });
});
