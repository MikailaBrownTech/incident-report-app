import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Fog } from "@/components/fog";
import { SkinToggle } from "@/components/skin-toggle";
import { getCopy } from "@/copy";
import { safeNext } from "@/features/workspaces/schema";
import { getSkin } from "@/lib/skin";
import { getSession } from "@/server/auth/session";

/** Shared server component behind /sign-in and /sign-up (same flow, different copy). */
export async function AuthPage({
  mode,
  searchParams,
}: {
  mode: "sign-in" | "sign-up";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { callbackUrl } = await searchParams;
  const target = safeNext(typeof callbackUrl === "string" ? callbackUrl : undefined);
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
        <h1 className="flicker text-3xl font-bold">
          {mode === "sign-in" ? t.auth.signInHeading : t.auth.signUpHeading}
        </h1>
        <p className="text-muted">{mode === "sign-in" ? t.auth.signInHelp : t.auth.signUpHelp}</p>
        <AuthForm mode={mode} callbackUrl={target} />
      </section>
    </main>
  );
}
