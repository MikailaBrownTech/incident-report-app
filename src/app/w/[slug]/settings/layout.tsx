import Link from "next/link";
import { getCopy } from "@/copy";
import { requireWorkspace } from "@/server/auth/context";

export default async function SettingsLayout({ children, params }: LayoutProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  const t = getCopy(ctx.skin);
  const tab = "rounded px-3 py-1.5 text-sm hover:bg-surface";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.settings.heading}</h1>
      <nav className="flex gap-1 border-b border-border pb-2">
        <Link href={`/w/${slug}/settings`} className={tab}>
          {t.settings.heading}
        </Link>
        <Link href={`/w/${slug}/settings/members`} className={tab}>
          {t.nav.members}
        </Link>
      </nav>
      {children}
    </div>
  );
}
