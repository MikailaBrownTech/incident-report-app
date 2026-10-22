"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { dangerButton, secondaryButton } from "@/components/form";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import type { InviteView } from "@/features/workspaces/queries";
import { api } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-messages";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export function PendingInvites({ slug, invites }: { slug: string; invites: InviteView[] }) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<InviteView | null>(null);

  async function resend(invite: InviteView) {
    setBusyId(invite.id);
    const result = await api(`/api/w/${slug}/invites/${invite.id}/resend`, { method: "POST" });
    setBusyId(null);
    if (!result.ok) toast.error(apiErrorMessage(t, result.code));
    else toast.success(t.members.inviteResent(invite.email));
    router.refresh();
  }

  async function revoke(invite: InviteView) {
    setBusyId(invite.id);
    const result = await api(`/api/w/${slug}/invites/${invite.id}`, { method: "DELETE" });
    setBusyId(null);
    setConfirming(null);
    if (!result.ok) toast.error(apiErrorMessage(t, result.code));
    else toast.success(t.members.inviteRevoked);
    router.refresh();
  }

  if (invites.length === 0) return <EmptyState message={t.members.pendingEmpty} />;

  return (
    <>
      <ul className="divide-y divide-border rounded border border-border">
        {invites.map((i) => (
          <li key={i.id} data-testid={`invite-${i.email}`} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate">{i.email}</p>
              <p className="text-sm text-muted">
                {t.workspaceRole[i.role]}
                {" · "}
                {i.status === "expired" ? t.members.expired : t.members.expires(formatDate(i.expiresAt))}
              </p>
            </div>
            <button type="button" className={secondaryButton} disabled={busyId === i.id} onClick={() => resend(i)}>
              {t.members.resend}
            </button>
            <button type="button" className={dangerButton} disabled={busyId === i.id} onClick={() => setConfirming(i)}>
              {t.members.revoke}
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirming !== null}
        title={t.members.revokeConfirmTitle(confirming?.email ?? "")}
        body={t.members.revokeConfirmBody}
        confirmLabel={t.members.revoke}
        pending={busyId !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && revoke(confirming)}
      />
    </>
  );
}
