"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useCopy } from "@/copy/provider";

export interface SwitcherWorkspace {
  slug: string;
  name: string;
}

/** Lists the user's workspaces, switches between them, and links to "Create workspace". */
export function WorkspaceSwitcher({ workspaces, currentSlug }: { workspaces: SwitcherWorkspace[]; currentSlug: string }) {
  const t = useCopy();
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const current = workspaces.find((w) => w.slug === currentSlug);

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpenOn(null);
      }}
    >
      <button
        type="button"
        data-testid="workspace-switcher"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="workspace-list"
        onClick={() => setOpenOn(open ? null : pathname)}
        className="flex w-full items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block text-xs text-muted">{t.userMenu.switchWorkspace}</span>
          <span className="block truncate font-semibold">{current?.name}</span>
        </span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <ul
          id="workspace-list"
          className="absolute inset-x-0 z-30 mt-1 space-y-1 rounded-pop border border-border bg-surface p-2 shadow-pop"
        >
          {workspaces.map((w) => (
            <li key={w.slug}>
              <Link
                href={`/app/${w.slug}/dashboard`}
                aria-current={w.slug === currentSlug ? "true" : undefined}
                className={`block truncate rounded px-2 py-1.5 text-sm hover:bg-bg ${
                  w.slug === currentSlug ? "font-semibold text-accent" : ""
                }`}
              >
                {w.name}
              </Link>
            </li>
          ))}
          <li className="border-t border-border pt-1">
            <Link href="/onboarding" className="block rounded px-2 py-1.5 text-sm text-accent hover:bg-bg">
              {t.userMenu.newWorkspace}
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
