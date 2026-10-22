import { dangerButton, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/form";
import { EmptyState } from "@/components/empty-state";
import { emptyMessage, getCopy, type CopyDictionary } from "@/copy";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
} from "@/features/workspaces/actions";
import type { MemberError } from "@/features/workspaces/members";
import type { Role } from "@/generated/prisma/client";
import { canAssignRole, canRemoveMember } from "@/server/auth/permissions";
import { requireWorkspace } from "@/server/auth/context";

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER"];

function errorMessage(t: CopyDictionary, code: string): string {
  const map: Record<MemberError | "invalid", string> = {
    forbidden: t.members.roleNotAllowed,
    not_found: t.errors.notFound,
    already_member: t.members.alreadyMember,
    last_owner: t.members.lastOwner,
    has_rituals: t.members.hasRituals,
    invalid: t.validation.invalidEmail,
  };
  return map[code as keyof typeof map] ?? t.errors.generic;
}

export default async function MembersPage({ params, searchParams }: PageProps<"/w/[slug]/settings/members">) {
  const { slug } = await params;
  const { e, ok, invited } = await searchParams;
  const ctx = await requireWorkspace(slug);
  const t = getCopy(ctx.skin);
  const actor = ctx.membership.role;

  const [members, invites] = await Promise.all([
    ctx.db.membership.findMany({ include: { user: true }, orderBy: { createdAt: "asc" } }),
    ctx.can("members.invite")
      ? ctx.db.invite.findMany({ where: { acceptedAt: null }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);
  const inviteRoles = ROLES.filter((r) => canAssignRole(actor, "MEMBER", r));

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold">{t.members.heading}</h2>

      {typeof e === "string" ? (
        <p role="alert" className="rounded border border-danger px-3 py-2 text-danger">
          {errorMessage(t, e)}
        </p>
      ) : null}
      {typeof invited === "string" ? (
        <p role="status" className="rounded border border-success px-3 py-2 text-success">
          {t.members.inviteSent(invited)}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded border border-success px-3 py-2 text-success">
          {t.members.updated}
        </p>
      ) : null}

      {members.length === 0 ? (
        <EmptyState message={emptyMessage(t, "members")} />
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {members.map((m) => {
            const isSelf = m.userId === ctx.user.id;
            const canEdit = canAssignRole(actor, m.role, m.role);
            const canRemove = isSelf || canRemoveMember(actor, m.role);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.user.name} {isSelf ? t.members.you : null}
                  </p>
                  <p className="truncate text-sm text-muted">{m.user.email}</p>
                </div>
                {canEdit ? (
                  <form action={changeRoleAction.bind(null, slug, m.userId)} className="flex items-center gap-2">
                    <label htmlFor={`role-${m.id}`} className="sr-only">
                      {t.members.roleLabel}
                    </label>
                    <select
                      id={`role-${m.id}`}
                      name="role"
                      defaultValue={m.role}
                      className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
                    >
                      {ROLES.filter((r) => canAssignRole(actor, m.role, r)).map((r) => (
                        <option key={r} value={r}>
                          {t.workspaceRole[r]}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={secondaryButton}>
                      {t.members.changeRole}
                    </button>
                  </form>
                ) : (
                  <span className="rounded border border-border px-2 py-0.5 text-sm">{t.workspaceRole[m.role]}</span>
                )}
                {canRemove ? (
                  <form action={removeMemberAction.bind(null, slug, m.userId)}>
                    <button type="submit" className={dangerButton}>
                      {t.actions.remove}
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {ctx.can("members.invite") ? (
        <>
          <section className="max-w-md space-y-3">
            <h3 className="text-lg font-semibold">{t.members.inviteHeading}</h3>
            <form action={inviteMemberAction.bind(null, slug)} className="space-y-3">
              <div>
                <label htmlFor="invite-email" className={labelClass}>
                  {t.members.emailLabel}
                </label>
                <input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  placeholder={t.auth.emailPlaceholder}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="invite-role" className={labelClass}>
                  {t.members.roleLabel}
                </label>
                <select id="invite-role" name="role" defaultValue="MEMBER" className={inputClass}>
                  {inviteRoles.map((r) => (
                    <option key={r} value={r}>
                      {t.workspaceRole[r]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className={primaryButton}>
                {t.actions.invite}
              </button>
            </form>
          </section>

          {invites.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-lg font-semibold">{t.members.pendingInvites}</h3>
              <ul className="divide-y divide-border rounded border border-border">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{i.email}</p>
                      <p className="text-sm text-muted">
                        {t.workspaceRole[i.role]}
                        {" · "}
                        {t.members.expires(i.expiresAt.toISOString().slice(0, 10))}
                      </p>
                    </div>
                    <form action={revokeInviteAction.bind(null, slug, i.id)}>
                      <button type="submit" className={secondaryButton}>
                        {t.members.revoke}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
