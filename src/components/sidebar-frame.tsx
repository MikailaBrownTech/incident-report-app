"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { secondaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";

/**
 * Sidebar on md+; on narrow screens a top bar whose menu button reveals the same panel
 * (rendered once, so there are no duplicate controls). The panel closes after navigation.
 */
export function SidebarFrame({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const t = useCopy();
  const pathname = usePathname();
  // Remember which page the menu was opened on, so navigating elsewhere closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  return (
    <aside className="relative z-10 border-b border-border bg-bg/80 md:min-h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-3 p-4">
        {brand}
        <button
          type="button"
          className={`${secondaryButton} md:hidden`}
          aria-expanded={open}
          aria-controls="sidebar-panel"
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          {open ? t.a11y.closeMenu : t.a11y.openMenu}
        </button>
      </div>
      <div id="sidebar-panel" className={`${open ? "block" : "hidden"} md:block`}>
        {children}
      </div>
    </aside>
  );
}
