import Link from "next/link";
import { redirect } from "next/navigation";
import { Fog } from "@/components/fog";
import { SkinToggle } from "@/components/skin-toggle";
import { getCopy } from "@/copy";
import { getSkin } from "@/lib/skin";
import { getSession } from "@/server/auth/session";

export default async function Home() {
  if (await getSession()) redirect("/app");

  const skin = await getSkin();
  const t = getCopy(skin);

  return (
    <main className="relative isolate flex flex-1 flex-col">
      <Fog />
      <header className="relative z-10 flex items-center justify-between p-6">
        <span className="flicker text-xl font-bold">{t.brand.name}</span>
        <SkinToggle skin={skin} />
      </header>
      <section className="relative z-10 mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-6 p-6">
        <h1 className="flicker text-4xl font-bold">{t.brand.tagline}</h1>
        <p className="text-muted">{t.postmortem.blamelessNote}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/sign-in" className="inline-block rounded bg-accent px-4 py-2 font-medium text-accent-fg">
            {t.nav.signIn}
          </Link>
          <Link href="/sign-up" className="inline-block rounded border border-border bg-surface px-4 py-2">
            {t.nav.signUp}
          </Link>
        </div>
      </section>
    </main>
  );
}
