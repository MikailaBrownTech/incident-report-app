import { redirect } from "next/navigation";
import { Fog } from "@/components/fog";
import { SkinToggle } from "@/components/skin-toggle";
import { getCopy } from "@/copy";
import { safeNext } from "@/features/workspaces/schema";
import { getSkin } from "@/lib/skin";
import { getSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = safeNext(typeof next === "string" ? next : undefined);
  if (await getSession()) redirect(target);

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
        <h1 className="flicker text-3xl font-bold">{t.auth.signInHeading}</h1>
        <p className="text-muted">{t.auth.signInHelp}</p>
        <LoginForm next={target} />
      </section>
    </main>
  );
}
