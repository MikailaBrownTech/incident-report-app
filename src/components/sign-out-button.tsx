"use client";

import { useRouter } from "next/navigation";
import { secondaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const t = useCopy();
  const router = useRouter();
  return (
    <button
      type="button"
      className={secondaryButton}
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      {t.nav.signOut}
    </button>
  );
}
