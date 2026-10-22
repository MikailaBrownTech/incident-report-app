"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCopy } from "@/copy";
import { requireWorkspace, toSkinKey } from "@/server/auth/context";
import { getSession } from "@/server/auth/session";
import { acceptInvite, createWorkspaceWithOwner } from "@/server/db/root";
import { buildActionEmail, sendEmail } from "@/server/email/send";
import { changeMemberRole, inviteMember, removeMember, revokeInvite, type MemberError } from "./members";
import { emailSchema, roleSchema, workspaceNameSchema } from "./schema";

const baseUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const membersPath = (slug: string) => `/w/${slug}/settings/members`;

function back(slug: string, params: Record<string, string>): never {
  redirect(`${membersPath(slug)}?${new URLSearchParams(params)}`);
}
const fail = (slug: string, error: MemberError): never => back(slug, { e: error });

export async function createWorkspaceAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login?next=/onboarding");
  const name = workspaceNameSchema.safeParse(formData.get("name"));
  if (!name.success) redirect("/onboarding?e=invalid");
  const workspace = await createWorkspaceWithOwner({ userId: session.user.id, name: name.data });
  redirect(`/w/${workspace.slug}/dashboard`);
}

export async function renameWorkspaceAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug);
  if (!ctx.can("workspace.rename")) redirect(`/w/${slug}/settings?e=forbidden`);
  const name = workspaceNameSchema.safeParse(formData.get("name"));
  if (!name.success) redirect(`/w/${slug}/settings?e=invalid`);
  await ctx.db.workspace.update({ where: { id: ctx.workspace.id }, data: { name: name.data } });
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/settings?ok=1`);
}

export async function inviteMemberAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug);
  if (!ctx.can("members.invite")) return fail(slug, "forbidden");
  const email = emailSchema.safeParse(formData.get("email"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!email.success || !role.success) return back(slug, { e: "invalid" });

  const res = await inviteMember(ctx, { email: email.data, role: role.data });
  if (!res.ok) return fail(slug, res.error);

  const t = getCopy(toSkinKey(ctx.workspace.skin));
  await sendEmail(
    buildActionEmail({
      to: email.data,
      subject: t.email.inviteSubject(ctx.workspace.name),
      body: t.email.inviteBody(ctx.workspace.name, t.workspaceRole[role.data]),
      button: t.email.inviteButton,
      url: `${baseUrl()}/invite/${res.token}`,
      footer: t.email.ignoreIfNotYou,
    }),
  );
  revalidatePath(membersPath(slug));
  back(slug, { invited: email.data });
}

export async function changeRoleAction(slug: string, userId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug);
  const role = roleSchema.safeParse(formData.get("role"));
  if (!role.success) return back(slug, { e: "invalid" });
  const res = await changeMemberRole(ctx, userId, role.data);
  if (!res.ok) return fail(slug, res.error);
  revalidatePath(membersPath(slug));
  back(slug, { ok: "1" });
}

export async function removeMemberAction(slug: string, userId: string) {
  const ctx = await requireWorkspace(slug);
  const res = await removeMember(ctx, userId);
  if (!res.ok) return fail(slug, res.error);
  if (userId === ctx.user.id) redirect("/");
  revalidatePath(membersPath(slug));
  back(slug, { ok: "1" });
}

export async function revokeInviteAction(slug: string, inviteId: string) {
  const ctx = await requireWorkspace(slug);
  const res = await revokeInvite(ctx, inviteId);
  if (!res.ok) return fail(slug, res.error);
  revalidatePath(membersPath(slug));
  back(slug, { ok: "1" });
}

export async function acceptInviteAction(token: string) {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const res = await acceptInvite({ rawToken: token, userId: session.user.id, userEmail: session.user.email });
  if (res.status === "accepted") redirect(`/w/${res.slug}/dashboard`);
  redirect(`/invite/${token}`);
}
