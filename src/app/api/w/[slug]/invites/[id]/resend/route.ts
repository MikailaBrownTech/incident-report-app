import { memberError, sendInviteEmail } from "@/features/workspaces/api-support";
import { resendInvite } from "@/features/workspaces/members";
import { handle, json } from "@/server/api/http";
import { getApiWorkspaceContext, requireRole } from "@/server/auth/context";

/** POST /api/w/{slug}/invites/{id}/resend: new link, fresh 7 days; the previous link stops working. */
export const POST = handle(
  async (_request: Request, { params }: RouteContext<"/api/w/[slug]/invites/[id]/resend">) => {
    const { slug, id } = await params;
    const ctx = await getApiWorkspaceContext(slug);
    requireRole(ctx, "ADMIN");

    const result = await resendInvite(ctx, id);
    if (!result.ok) throw memberError(result.error);
    await sendInviteEmail(ctx, { email: result.email, role: result.role, token: result.token });
    return json({ resent: true });
  },
);
