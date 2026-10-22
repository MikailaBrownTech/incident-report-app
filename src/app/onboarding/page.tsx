import { redirect } from "next/navigation";
import { Fog } from "@/components/fog";
import { OnboardingForm } from "@/components/onboarding-form";
import { SkinToggle } from "@/components/skin-toggle";
import { getCopy } from "@/copy";
import { getSkin } from "@/lib/skin";
import { getSession } from "@/server/auth/session";

export default async function OnboardingPage() {
  if (!(await getSession())) redirect("/sign-in?callbackUrl=/onboarding");
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
        <OnboardingForm />
      </section>
    </main>
  );
}
