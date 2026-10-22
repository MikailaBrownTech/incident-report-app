"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { dangerButton } from "@/components/form";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import type { MemberView } from "@/features/workspaces/queries";
import type { Role } from "@/generated/prisma/client";
import { api } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-messages";
import { canAssignRole, canRemoveMember } from "@/server/auth/permissions";

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER"];

// Fixed locale and UTC so server and browser render the same text.
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export function MembersTable({
  slug,
  members,
  currentUserId,
  actorRole,
}: {
  slug: string;
  members: MemberView[];
  currentUserId: string;
  actorRole: Role;
}) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<MemberView | null>(null);

  async function changeRole(member: MemberView, role: Role) {
    setBusyUserId(member.userId);
    const result = await api(`/api/w/${slug}/members/${member.userId}`, { method: "PATCH", body: { role } });
    setBusyUserId(null);
    if (!result.ok) toast.error(apiErrorMessage(t, result.code));
    else toast.success(t.members.roleChanged);
    router.refresh(); // on failure this also snaps the select back to the saved role
  }

  async function remove(member: MemberView) {
    const leaving = member.userId === currentUserId;
    setBusyUserId(member.userId);
    const result = await api(`/api/w/${slug}/members/${member.userId}`, { method: "DELETE" });
    setBusyUserId(null);
    setConfirming(null);
    if (!result.ok) {
      toast.error(apiErrorMessage(t, result.code));
      return;
    }
    toast.success(leaving ? t.members.left : t.members.memberRemoved);
    if (leaving) router.push("/app");
    else router.refresh();
  }

  const leaving = confirming?.userId === currentUserId;
  // Stacked cards on phones (each cell carries its own label), a real table from md up.
  const cell =
    "block px-3 py-1.5 md:table-cell md:p-3 before:block before:text-xs before:text-muted before:content-[attr(data-label)] md:before:hidden";

  return (
    <>
      <div className="rounded border border-border">
        <table role="table" className="block w-full text-left text-sm md:table">
          <caption className="sr-only">{t.members.heading}</caption>
          <thead role="rowgroup" className="sr-only md:not-sr-only md:table-header-group border-b border-border bg-surface text-muted">
            <tr role="row">
              <th role="columnheader" scope="col" className="p-3 font-medium">
                {t.members.tableName}
              </th>
              <th role="columnheader" scope="col" className="p-3 font-medium">
                {t.members.tableRole}
              </th>
              <th role="columnheader" scope="col" className="p-3 font-medium">
                {t.members.tableJoined}
              </th>
              <th role="columnheader" scope="col" className="p-3 font-medium">
                {t.members.tableActions}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="block md:table-row-group">
            {members.map((m) => {
              const isSelf = m.userId === currentUserId;
              const editableRoles = ROLES.filter((r) => canAssignRole(actorRole, m.role, r));
              const canEdit = canAssignRole(actorRole, m.role, m.role);
              const canRemove = !isSelf && canRemoveMember(actorRole, m.role);
              const busy = busyUserId === m.userId;
              return (
                <tr
                  key={m.userId}
                  role="row"
                  data-testid={`member-${m.email}`}
                  className="block border-b border-border p-2 last:border-b-0 md:table-row md:p-0"
                >
                  <td role="cell" className={cell}>
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name || m.email} image={m.image} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.name || m.email} {isSelf ? t.members.you : null}
                        </p>
                        {m.name ? <p className="truncate text-muted">{m.email}</p> : null}
                      </div>
                    </div>
                  </td>
                  <td role="cell" data-label={t.members.tableRole} className={cell}>
                    {canEdit ? (
                      <>
                        <label htmlFor={`role-${m.userId}`} className="sr-only">
                          {t.members.changeRole}
                        </label>
                        <select
                          id={`role-${m.userId}`}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => changeRole(m, e.target.value as Role)}
                          className="rounded border border-border bg-surface px-2 py-1.5"
                        >
                          {editableRoles.map((r) => (
                            <option key={r} value={r}>
                              {t.workspaceRole[r]}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span className="rounded border border-border px-2 py-0.5">{t.workspaceRole[m.role]}</span>
                    )}
                  </td>
                  <td role="cell" data-label={t.members.tableJoined} className={`${cell} text-muted`}>
                    {formatDate(m.joinedAt)}
                  </td>
                  <td
                    role="cell"
                    data-label={t.members.tableActions}
                    className={`${cell} ${isSelf || canRemove ? "" : "max-md:hidden"}`}
                  >
                    {isSelf || canRemove ? (
                      <button type="button" className={dangerButton} disabled={busy} onClick={() => setConfirming(m)}>
                        {isSelf ? t.members.leave : t.members.removeMember}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={leaving ? t.members.leaveConfirmTitle : t.members.removeConfirmTitle(confirming?.name || confirming?.email || "")}
        body={leaving ? t.members.leaveConfirmBody : t.members.removeConfirmBody}
        confirmLabel={leaving ? t.members.leave : t.members.removeMember}
        pending={busyUserId !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && remove(confirming)}
      />
    </>
  );
}
