"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { inputClass, labelClass, primaryButton } from "@/components/form";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import { emailSchema } from "@/features/workspaces/schema";
import { api } from "@/lib/api-client";
import { apiErrorMessage, fieldErrorMessage } from "@/lib/api-messages";

export function InviteForm({ slug }: { slug: string }) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(t.validation.invalidEmail);
      return;
    }
    setError(null);
    setPending(true);
    const result = await api(`/api/w/${slug}/invites`, { method: "POST", body: { email: parsed.data, role } });
    setPending(false);
    if (!result.ok) {
      const code = result.fieldErrors?.email?.[0];
      if (code) setError(fieldErrorMessage(t, code, "email"));
      else if (result.code === "already_member") setError(t.members.alreadyMember);
      else toast.error(apiErrorMessage(t, result.code));
      return;
    }
    toast.success(t.members.inviteSent(parsed.data));
    setEmail("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <div>
        <label htmlFor="invite-email" className={labelClass}>
          {t.members.emailLabel}
        </label>
        <input
          id="invite-email"
          type="email"
          autoComplete="off"
          placeholder={t.auth.emailPlaceholder}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "invite-email-error" : undefined}
          className={inputClass}
        />
        {error ? (
          <p id="invite-email-error" className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="invite-role" className={labelClass}>
          {t.members.roleLabel}
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}
          className={inputClass}
        >
          <option value="MEMBER">{t.workspaceRole.MEMBER}</option>
          <option value="ADMIN">{t.workspaceRole.ADMIN}</option>
        </select>
      </div>
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? t.members.sendingInvite : t.members.sendInvite}
      </button>
    </form>
  );
}
