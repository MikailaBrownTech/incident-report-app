import { getCopy } from "@/copy";
import type { Role } from "@/generated/prisma/client";
import { ApiError } from "@/server/api/http";
import { toSkinKey, type WorkspaceContext } from "@/server/auth/context";
import { appUrl } from "@/server/env";
import { buildActionEmail, sendEmail } from "@/server/email/send";
import type { MemberError } from "./members";

const MESSAGES: Record<MemberError, { status: number; message: string }> = {
  forbidden: { status: 403, message: "Your role can't make that change." },
  not_found: { status: 404, message: "Not found." },
  already_member: { status: 409, message: "That person is already a member." },
  last_owner: { status: 409, message: "A workspace needs at least one owner." },
  has_rituals: { status: 409, message: "Reassign their action items before removing them." },
};

/** Translate a service-layer failure into the standard API error. */
export function memberError(code: MemberError): ApiError {
  const { status, message } = MESSAGES[code];
  return new ApiError(status, code, message);
}

/** Emails the invite link, worded in the workspace's skin. */
export async function sendInviteEmail(
  ctx: Pick<WorkspaceContext, "workspace">,
  invite: { email: string; role: Role; token: string },
): Promise<void> {
  const t = getCopy(toSkinKey(ctx.workspace.skin));
  await sendEmail(
    buildActionEmail({
      to: invite.email,
      subject: t.email.inviteSubject(ctx.workspace.name),
      body: t.email.inviteBody(ctx.workspace.name, t.workspaceRole[invite.role]),
      button: t.email.inviteButton,
      url: `${appUrl()}/invite/${invite.token}`,
      footer: t.email.ignoreIfNotYou,
    }),
  );
}
