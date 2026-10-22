import Link from "next/link";
import type { ReactNode } from "react";
import { Fog } from "@/components/fog";
import { SignOutButton } from "@/components/sign-out-button";
import { SkinToggle } from "@/components/skin-toggle";
import { getCopy, type SkinKey } from "@/copy";

interface AppShellProps {
  skin: SkinKey;
  slug: string;
  workspaceName: string;
  userEmail: string;
  workspaces: { slug: string; name: string }[];
  children: ReactNode;
}

export function AppShell({ skin, slug, workspaceName, userEmail, workspaces, children }: AppShellProps) {
  const t = getCopy(skin);
  const base = `/w/${slug}`;
  const link = "rounded px-2 py-1 hover:bg-surface";

  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <Fog />
      <a
        href="#content"
        className="sr-only z-20 bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      >
        {t.a11y.skipToContent}
      </a>
      <header className="relative z-10 border-b border-border bg-bg/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 p-4">
          <Link href={`${base}/dashboard`} className="flicker text-lg font-bold">
            {workspaceName}
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1 text-sm">
            <Link href={`${base}/dashboard`} className={link}>
              {t.nav.dashboard}
            </Link>
            <Link href={`${base}/settings`} className={link}>
              {t.nav.settings}
            </Link>
          </nav>
          <SkinToggle skin={skin} workspaceSlug={slug} />
          <details className="relative">
            <summary className="cursor-pointer list-none rounded border border-border bg-surface px-3 py-1.5 text-sm">
              {userEmail}
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 space-y-3 rounded border border-border bg-surface p-3 shadow">
              <p className="text-xs font-semibold text-muted">{t.userMenu.workspaces}</p>
              <ul className="space-y-1 text-sm">
                {workspaces.map((w) => (
                  <li key={w.slug}>
                    <Link href={`/w/${w.slug}/dashboard`} className="block rounded px-2 py-1 hover:bg-bg">
                      {w.name}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/onboarding" className="block rounded px-2 py-1 text-accent hover:bg-bg">
                    {t.userMenu.newWorkspace}
                  </Link>
                </li>
              </ul>
              <SignOutButton />
            </div>
          </details>
        </div>
      </header>
      <main id="content" className="relative z-10 mx-auto w-full max-w-5xl flex-1 p-4">
        {children}
      </main>
    </div>
  );
}
