import Link from "next/link";
import { getCopy } from "@/copy";
import { getWorkspaceContext } from "@/server/auth/context";

export default async function SettingsLayout({ children, params }: LayoutProps<"/app/[slug]/settings">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);
  const tab = "rounded px-3 py-1.5 text-sm hover:bg-surface";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.settings.heading}</h1>
      <nav className="flex gap-1 border-b border-border pb-2">
        <Link href={`/app/${slug}/settings`} className={tab}>
          {t.settings.general}
        </Link>
        <Link href={`/app/${slug}/settings/members`} className={tab}>
          {t.nav.members}
        </Link>
        <Link href={`/app/${slug}/settings/services`} className={tab}>
          {t.nav.services}
        </Link>
      </nav>
      {children}
    </div>
  );
}
