import { InviteForm } from "@/components/invite-form";
import { MembersTable } from "@/components/members-table";
import { PendingInvites } from "@/components/pending-invites";
import { getCopy } from "@/copy";
import { listMembers, listPendingInvites } from "@/features/workspaces/queries";
import { getWorkspaceContext } from "@/server/auth/context";

export default async function MembersPage({ params }: PageProps<"/app/[slug]/settings/members">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);
  const canInvite = ctx.can("members.invite");

  const [members, invites] = await Promise.all([
    listMembers(ctx.db),
    canInvite ? listPendingInvites(ctx.db) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t.members.heading}</h2>
        {canInvite ? null : <p className="text-sm text-muted">{t.members.readOnlyNote}</p>}
        <MembersTable slug={slug} members={members} currentUserId={ctx.user.id} actorRole={ctx.membership.role} />
      </section>

      {canInvite ? (
        <>
          <section className="max-w-md space-y-3">
            <h2 className="text-lg font-semibold">{t.members.inviteHeading}</h2>
            <InviteForm slug={slug} />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t.members.pendingInvites}</h2>
            <PendingInvites slug={slug} invites={invites} />
          </section>
        </>
      ) : null}
    </div>
  );
}
