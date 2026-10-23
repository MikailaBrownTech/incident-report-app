"use client";

import { useEffect, useRef, useState } from "react";
import { AddItemForm } from "@/components/action-item-form";
import { IncidentChip } from "@/components/action-item-bits";
import { inputClass, primaryButton, secondaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import type { ActionItemView } from "@/features/action-items/schema";

export interface QuickIncident {
  number: number;
  title: string;
  severity: number;
}

interface Props {
  slug: string;
  /** Incidents that have a postmortem (the only ones an action item can be added to). */
  incidents: QuickIncident[];
  members: PersonView[];
  currentUserId: string;
  onCreated: (item: ActionItemView, people: Record<string, PersonView>) => void;
}

/** "Quick add": pick an incident (searchable), then the usual create form. */
export function ActionQuickAdd({ slug, incidents, members, currentUserId, onCreated }: Props) {
  const t = useCopy();
  const r = t.ritual;
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<QuickIncident | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQ("");
    setChosen(null);
  };
  const needle = q
    .trim()
    .toLowerCase()
    .replace(/^#|^inc-?/, "");
  const matches = incidents
    .filter((i) => !needle || i.title.toLowerCase().includes(needle) || String(i.number).startsWith(needle))
    .slice(0, 8);

  return (
    <>
      <button type="button" className={primaryButton} onClick={() => setOpen(true)}>
        {r.board.quickAdd}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="quick-add-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        className="m-auto w-[min(92vw,30rem)] rounded-pop border shadow-pop border-border bg-surface p-5 text-fg backdrop:bg-ground/70"
      >
        <h2 id="quick-add-title" className="text-lg font-semibold">
          {r.board.quickAddTitle}
        </h2>
        {chosen ? (
          <div className="mt-3 space-y-3">
            <p className="flex items-center gap-2 text-sm">
              <IncidentChip slug={slug} incident={chosen} />
              <span className="truncate">{chosen.title}</span>
            </p>
            <AddItemForm
              slug={slug}
              incidentNumber={chosen.number}
              members={members}
              currentUserId={currentUserId}
              autoFocus
              onCancel={close}
              onCreated={(item, people) => {
                onCreated(item, people);
                close();
              }}
            />
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <label htmlFor="quick-add-search" className="sr-only">
              {r.board.chooseIncident}
            </label>
            <input
              id="quick-add-search"
              type="search"
              value={q}
              autoFocus
              placeholder={r.board.chooseIncident}
              onChange={(e) => setQ(e.target.value)}
              className={inputClass}
            />
            {matches.length === 0 ? (
              <p className="text-sm text-muted">{r.board.noIncidentMatch}</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {matches.map((i) => (
                  <li key={i.number}>
                    <button
                      type="button"
                      onClick={() => setChosen(i)}
                      className="flex w-full items-center gap-2 rounded border border-border px-3 py-2 text-left hover:border-accent"
                    >
                      <span className="text-sm">{t.incident.number(i.number)}</span>
                      <span className="truncate">{i.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button type="button" className={secondaryButton} onClick={close}>
                {t.actions.cancel}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
