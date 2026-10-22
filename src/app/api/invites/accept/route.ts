import { acceptInviteBody } from "@/features/workspaces/schema";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getSession } from "@/server/auth/session";
import { acceptInvite } from "@/server/db/root";

const FAILURES = {
  wrong_email: [403, "email_mismatch", "This invite was sent to a different email address."],
  not_found: [404, "invite_not_found", "This invite link isn't valid."],
  expired: [410, "invite_expired", "This invite has expired."],
  revoked: [410, "invite_revoked", "This invite was revoked."],
  used: [409, "invite_used", "This invite has already been used."],
} as const;

/** POST /api/invites/accept: the signed-in user redeems an invite token. */
export const POST = handle(async (request: Request) => {
  const session = await getSession();
  if (!session) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  const { token } = await readBody(request, acceptInviteBody);

  const result = await acceptInvite({ rawToken: token, userId: session.user.id, userEmail: session.user.email });
  if (result.status !== "accepted") {
    const [status, code, message] = FAILURES[result.status];
    throw new ApiError(status, code, message);
  }
  return json({ workspace: { slug: result.slug } });
});
