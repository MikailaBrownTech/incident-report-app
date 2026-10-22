"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { inputClass, labelClass, primaryButton } from "@/components/form";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import { workspaceNameSchema } from "@/features/workspaces/schema";
import { api } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-messages";

export function WorkspaceNameForm({ slug, initialName, canEdit }: { slug: string; initialName: string; canEdit: boolean }) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = workspaceNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(t.validation.required);
      return;
    }
    setError(null);
    setPending(true);
    const result = await api(`/api/w/${slug}`, { method: "PATCH", body: { name: parsed.data } });
    setPending(false);
    if (!result.ok) {
      toast.error(apiErrorMessage(t, result.code));
      return;
    }
    toast.success(t.settings.saved);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <div>
        <label htmlFor="workspace-name" className={labelClass}>
          {t.settings.workspaceName}
        </label>
        <input
          id="workspace-name"
          value={name}
          maxLength={60}
          disabled={!canEdit}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "workspace-name-error" : undefined}
          className={inputClass}
        />
        {error ? (
          <p id="workspace-name-error" className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <button type="submit" disabled={pending} className={primaryButton}>
          {t.settings.save}
        </button>
      ) : null}
    </form>
  );
}
