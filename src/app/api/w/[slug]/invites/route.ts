import { memberError, sendInviteEmail } from "@/features/workspaces/api-support";
import { inviteMember } from "@/features/workspaces/members";
import { listPendingInvites } from "@/features/workspaces/queries";
import { createInviteBody } from "@/features/workspaces/schema";
import { handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

type Context = RouteContext<"/api/w/[slug]/invites">;

/** GET /api/w/{slug}/invites: pending invites (admins and owners only; they contain email addresses). */
export const GET = handle(async (_request: Request, { params }: Context) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  requireRole(ctx, "ADMIN");
  return json({ invites: await listPendingInvites(ctx.db) });
});

/** POST /api/w/{slug}/invites: invite by email as ADMIN or MEMBER; emails a 7-day link. */
export const POST = handle(async (request: Request, { params }: Context) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  requireRole(ctx, "ADMIN");
  const body = await readBody(request, createInviteBody);

  const result = await inviteMember(ctx, body);
  if (!result.ok) throw memberError(result.error);
  await sendInviteEmail(ctx, { email: body.email, role: body.role, token: result.token });

  const invite = (await listPendingInvites(ctx.db)).find((i) => i.id === result.inviteId);
  return json({ invite }, 201);
});
