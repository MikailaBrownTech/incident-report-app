"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { inputClass, labelClass, primaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";
import { emailSchema } from "@/features/workspaces/schema";
import { authClient } from "@/lib/auth-client";

type Status = "idle" | "sending" | "sent" | "error";

/** Magic-link form shared by /sign-in and /sign-up; only the copy and the cross-link differ. */
export function AuthForm({ mode, callbackUrl }: { mode: "sign-in" | "sign-up"; callbackUrl: string }) {
  const t = useCopy();
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setStatus("sending");
    const { error } = await authClient.signIn.magicLink({ email: parsed.data, callbackURL: callbackUrl });
    setStatus(error ? "error" : "sent");
  }

  if (status === "sent") {
    return (
      <div role="status" className="space-y-2">
        <h2 className="text-xl font-semibold">{t.auth.checkEmailHeading}</h2>
        <p className="text-muted">{t.auth.checkEmailBody(email.trim())}</p>
      </div>
    );
  }

  const other = mode === "sign-in" ? "/sign-up" : "/sign-in";
  const otherHref = `${other}?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="email" className={labelClass}>
          {t.auth.emailLabel}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t.auth.emailPlaceholder}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (invalid) setInvalid(false);
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? "email-error" : undefined}
          className={inputClass}
        />
        {invalid ? (
          <p id="email-error" className="mt-1 text-sm text-danger">
            {t.validation.invalidEmail}
          </p>
        ) : null}
      </div>
      {status === "error" ? (
        <p role="alert" className="text-danger">
          {t.auth.linkFailed}
        </p>
      ) : null}
      <button type="submit" disabled={status === "sending"} className={primaryButton}>
        {status === "sending" ? t.auth.sending : mode === "sign-in" ? t.auth.sendLinkSignIn : t.auth.sendLinkSignUp}
      </button>
      <p className="text-sm">
        <Link href={otherHref} className="text-accent underline underline-offset-2">
          {mode === "sign-in" ? t.auth.noAccount : t.auth.hasAccount}
        </Link>
      </p>
    </form>
  );
}
