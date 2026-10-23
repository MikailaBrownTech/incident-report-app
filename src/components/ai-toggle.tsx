"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import { api } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-messages";

/** Admin switch for the AI features of one workspace. */
export function AiToggle({ slug, enabled, canEdit }: { slug: string; enabled: boolean; canEdit: boolean }) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, setPending] = useState(false);

  async function change(next: boolean) {
    setPending(true);
    const result = await api(`/api/w/${slug}`, { method: "PATCH", body: { aiEnabled: next } });
    setPending(false);
    if (!result.ok) {
      toast.error(apiErrorMessage(t, result.code));
      return;
    }
    setOn(next);
    toast.success(t.settings.saved);
    router.refresh();
  }

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{t.settings.aiHeading}</h2>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} disabled={!canEdit || pending} onChange={(e) => change(e.target.checked)} />
        {t.settings.aiLabel}
      </label>
      <p className="text-sm text-muted">{t.settings.aiHint}</p>
    </section>
  );
}
