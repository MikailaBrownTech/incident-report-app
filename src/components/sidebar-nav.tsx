"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** A count shown beside the label (spoken as "N overdue"); hidden when zero. */
  badge?: number;
  /** Spoken in place of the number, e.g. "2 overdue". */
  badgeLabel?: string;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // Settings > Services has its own entry, so highlight only the most specific match.
  const matching = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const current = matching.sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="space-y-1 text-sm">
      {items.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`block rounded px-3 py-2 hover:bg-surface ${active ? "bg-surface font-semibold text-accent" : ""}`}
          >
            {item.label}
            {item.badge ? (
              <span className="ml-2 rounded-tag border border-danger px-2 text-xs text-danger">
                <span aria-hidden="true">{item.badge}</span>
                <span className="sr-only">{item.badgeLabel ?? item.badge}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
