import { redirect } from "next/navigation";
import { Fog } from "@/components/fog";
import { inputClass, labelClass, primaryButton } from "@/components/form";
import { SkinToggle } from "@/components/skin-toggle";
import { getCopy } from "@/copy";
import { createWorkspaceAction } from "@/features/workspaces/actions";
import { getSkin } from "@/lib/skin";
import { getSession } from "@/server/auth/session";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  if (!(await getSession())) redirect("/login?next=/onboarding");
  const { e } = await searchParams;
  const skin = await getSkin();
  const t = getCopy(skin);

  return (
    <main className="relative isolate flex flex-1 flex-col">
      <Fog />
      <header className="relative z-10 flex items-center justify-between p-6">
        <span className="flicker text-xl font-bold">{t.brand.name}</span>
        <SkinToggle skin={skin} />
      </header>
      <section className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
        <h1 className="flicker text-3xl font-bold">{t.onboarding.heading}</h1>
        <p className="text-muted">{t.onboarding.help}</p>
        {e ? (
          <p role="alert" className="text-danger">
            {t.validation.required}
          </p>
        ) : null}
        <form action={createWorkspaceAction} className="space-y-4">
          <div>
            <label htmlFor="name" className={labelClass}>
              {t.onboarding.workspaceNameLabel}
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={60}
              placeholder={t.onboarding.workspaceNamePlaceholder}
              className={inputClass}
            />
          </div>
          <button type="submit" className={primaryButton}>
            {t.onboarding.create}
          </button>
        </form>
      </section>
    </main>
  );
}
