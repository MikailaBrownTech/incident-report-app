import Link from "next/link";
import type { ReactNode } from "react";
import { DeclareIncidentButton } from "@/components/declare-incident";
import { Fog } from "@/components/fog";
import { SidebarFrame } from "@/components/sidebar-frame";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { SkinToggle } from "@/components/skin-toggle";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "@/components/workspace-switcher";
import { getCopy, type SkinKey } from "@/copy";

interface AppShellProps {
  skin: SkinKey;
  slug: string;
  userEmail: string;
  workspaces: SwitcherWorkspace[];
  children: ReactNode;
}

export function AppShell({ skin, slug, userEmail, workspaces, children }: AppShellProps) {
  const t = getCopy(skin);
  const base = `/app/${slug}`;

  return (
    <div className="relative isolate min-h-screen md:flex">
      <Fog />
      <a
        href="#content"
        className="sr-only z-30 bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      >
        {t.a11y.skipToContent}
      </a>
      <SidebarFrame
        brand={
          <Link href={`${base}/dashboard`} className="flicker text-lg font-bold">
            {t.brand.name}
          </Link>
        }
      >
        <div className="space-y-6 p-4 pt-0">
          <WorkspaceSwitcher workspaces={workspaces} currentSlug={slug} />
          <SidebarNav
            items={[
              { href: `${base}/dashboard`, label: t.nav.dashboard },
              { href: `${base}/incidents`, label: t.nav.incidents },
              { href: `${base}/settings/services`, label: t.nav.services },
              { href: `${base}/settings`, label: t.nav.settings },
            ]}
          />
          <div className="space-y-3 border-t border-border pt-4">
            <SkinToggle skin={skin} workspaceSlug={slug} />
            <div className="text-sm">
              <p className="text-xs text-muted">{t.userMenu.signedInAs}</p>
              <p className="truncate">{userEmail}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </SidebarFrame>
      <div className="relative z-10 min-w-0 flex-1">
        <div className="flex items-center justify-end border-b border-border bg-bg/80 px-4 py-3 md:px-8">
          <DeclareIncidentButton />
        </div>
        <main id="content" className="p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
