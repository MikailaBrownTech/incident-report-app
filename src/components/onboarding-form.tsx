"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { inputClass, labelClass, primaryButton } from "@/components/form";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import { workspaceNameSchema } from "@/features/workspaces/schema";
import { checkSlug, suggestSlug } from "@/features/workspaces/slug";
import { api } from "@/lib/api-client";
import { apiErrorMessage, fieldErrorMessage } from "@/lib/api-messages";

type Errors = { name?: string; slug?: string };

export function OnboardingForm() {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  function validate(): Errors {
    const next: Errors = {};
    if (!workspaceNameSchema.safeParse(name).success) next.name = t.validation.required;
    const problem = checkSlug(slug.trim());
    if (problem) next.slug = fieldErrorMessage(t, problem, "slug");
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    const result = await api<{ workspace: { name: string; slug: string } }>("/api/workspaces", {
      method: "POST",
      body: { name: name.trim(), slug: slug.trim() },
    });
    if (!result.ok) {
      setPending(false);
      const fe = result.fieldErrors;
      if (fe?.slug?.[0] || fe?.name?.[0]) {
        setErrors({
          slug: fe.slug?.[0] ? fieldErrorMessage(t, fe.slug[0], "slug") : undefined,
          name: fe.name?.[0] ? fieldErrorMessage(t, fe.name[0], "name") : undefined,
        });
      } else if (result.code === "slug_taken") {
        setErrors({ slug: t.onboarding.slugTaken });
      } else {
        toast.error(apiErrorMessage(t, result.code));
      }
      return;
    }
    toast.success(t.onboarding.created(result.data.workspace.name));
    router.push(`/app/${result.data.workspace.slug}/dashboard`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="name" className={labelClass}>
          {t.onboarding.workspaceNameLabel}
        </label>
        <input
          id="name"
          name="name"
          autoComplete="organization"
          maxLength={60}
          placeholder={t.onboarding.workspaceNamePlaceholder}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(e.target.value.trim() ? suggestSlug(e.target.value) : "");
            if (errors.name) setErrors({ ...errors, name: undefined });
          }}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "name-error" : undefined}
          className={inputClass}
        />
        {errors.name ? (
          <p id="name-error" className="mt-1 text-sm text-danger">
            {errors.name}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="slug" className={labelClass}>
          {t.onboarding.slugLabel}
        </label>
        <input
          id="slug"
          name="slug"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          value={slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value.toLowerCase());
            if (errors.slug) setErrors({ ...errors, slug: undefined });
          }}
          aria-invalid={Boolean(errors.slug)}
          aria-describedby={errors.slug ? "slug-error" : "slug-help"}
          className={inputClass}
        />
        {errors.slug ? (
          <p id="slug-error" className="mt-1 text-sm text-danger">
            {errors.slug}
          </p>
        ) : (
          <p id="slug-help" className="mt-1 text-sm text-muted">
            {t.onboarding.slugHelp}
          </p>
        )}
      </div>

      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? t.onboarding.creating : t.onboarding.create}
      </button>
    </form>
  );
}
