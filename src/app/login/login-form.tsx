"use client";

import { useState, type FormEvent } from "react";
import { inputClass, labelClass, primaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";
import { authClient } from "@/lib/auth-client";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm({ next }: { next: string }) {
  const t = useCopy();
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: next });
    setStatus(error ? "error" : "sent");
  }

  if (status === "sent") {
    return (
      <div role="status" className="space-y-2">
        <h2 className="text-xl font-semibold">{t.auth.checkEmailHeading}</h2>
        <p className="text-muted">{t.auth.checkEmailBody(email)}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className={labelClass}>
          {t.auth.emailLabel}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t.auth.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>
      {status === "error" ? (
        <p role="alert" className="text-danger">
          {t.errors.generic}
        </p>
      ) : null}
      <button type="submit" disabled={status === "sending"} className={primaryButton}>
        {status === "sending" ? t.auth.sending : t.auth.sendLink}
      </button>
    </form>
  );
}
