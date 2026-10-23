"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { inputClass, secondaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import { isFiltered, type ItemFilters } from "@/features/action-items/schema";

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent"}`;

interface Props {
  filters: ItemFilters;
  members: PersonView[];
  incidents: { number: number; title: string }[];
}

/** Every filter writes to the URL, so a view can be shared and survives a reload. */
export function ActionFilters({ filters, members, incidents }: Props) {
  const t = useCopy();
  const f = t.ritual.board.filters;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [typed, setTyped] = useState<string | null>(null);
  const q = typed ?? filters.q;

  function update(changes: Record<string, string | null>, mode: "push" | "replace" = "push") {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (value !== null && value !== "") next.set(key, value);
    }
    const qs = next.toString();
    router[mode](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    if (typed === null || typed.trim() === filters.q) return;
    const timer = setTimeout(() => update({ q: typed.trim() || null }, "replace"), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="af-owner" className="sr-only">
          {f.owner}
        </label>
        <select
          id="af-owner"
          value={filters.owner}
          onChange={(e) => update({ owner: e.target.value === "any" ? null : e.target.value })}
          className={inputClass}
        >
          <option value="any">{`${f.owner}: ${f.anyone}`}</option>
          <option value="me">{`${f.owner}: ${f.me}`}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {`${f.owner}: ${m.name || m.email}`}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="af-incident" className="sr-only">
          {f.incident}
        </label>
        <select
          id="af-incident"
          value={filters.incident ?? ""}
          onChange={(e) => update({ incident: e.target.value || null })}
          className={inputClass}
        >
          <option value="">{f.anyIncident}</option>
          {incidents.map((i) => (
            <option key={i.number} value={i.number}>
              {`${t.incident.number(i.number)} ${i.title}`}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        aria-pressed={filters.overdue}
        className={chip(filters.overdue)}
        onClick={() => update({ overdue: filters.overdue ? null : "1" })}
      >
        {f.overdueOnly}
      </button>
      <button
        type="button"
        aria-pressed={filters.dueThisWeek}
        className={chip(filters.dueThisWeek)}
        onClick={() => update({ dueThisWeek: filters.dueThisWeek ? null : "1" })}
      >
        {f.dueThisWeek}
      </button>
      <div className="min-w-44 flex-1">
        <label htmlFor="af-search" className="sr-only">
          {f.search}
        </label>
        <input
          id="af-search"
          type="search"
          value={q}
          placeholder={f.searchPlaceholder}
          onChange={(e) => setTyped(e.target.value)}
          className={inputClass}
        />
      </div>
      {isFiltered(filters) && (
        <button type="button" className={secondaryButton} onClick={() => router.push(pathname)}>
          {t.ritual.board.clearFilters}
        </button>
      )}
    </div>
  );
}
