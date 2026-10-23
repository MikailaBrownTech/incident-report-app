import Link from "next/link";
import { Fog } from "@/components/fog";
import { primaryButton } from "@/components/form";
import { getCopy } from "@/copy";
import { getSkin } from "@/lib/skin";

/** The 404 page: missing pages, and also incidents or workspaces that don't exist or aren't yours (never a 403). */
export default async function NotFound() {
  const t = getCopy(await getSkin());
  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Fog />
      <div className="relative z-10 space-y-4">
        <p className="text-sm text-muted">{"404"}</p>
        <h1 className="flicker text-3xl font-bold">{t.errors.notFound}</h1>
        <Link href="/app" className={`${primaryButton} inline-block`}>
          {t.invite.backHome}
        </Link>
      </div>
    </main>
  );
}
