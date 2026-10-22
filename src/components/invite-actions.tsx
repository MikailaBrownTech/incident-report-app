"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { primaryButton, secondaryButton } from "@/components/form";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import { api } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

export function AcceptInviteButton({ token }: { token: string }) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    const result = await api<{ workspace: { slug: string } }>("/api/invites/accept", {
      method: "POST",
      body: { token },
    });
    if (!result.ok) {
      setPending(false);
      // Expired, revoked, used or mismatched: reload so the page shows the matching friendly state.
      router.refresh();
      toast.error(result.message);
      return;
    }
    router.push(`/app/${result.data.workspace.slug}/dashboard`);
  }

  return (
    <button type="button" onClick={accept} disabled={pending} className={primaryButton}>
      {pending ? t.invite.accepting : t.invite.accept}
    </button>
  );
}

/** Signs out, then returns to sign-in with the invite as the callback so the right account can be used. */
export function SwitchAccountButton({ token }: { token: string }) {
  const t = useCopy();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className={secondaryButton}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.push(`/sign-in?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
        router.refresh();
      }}
    >
      {t.invite.switchAccount}
    </button>
  );
}
