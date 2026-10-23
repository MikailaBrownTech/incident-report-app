"use client";

import { useState } from "react";
import { ActionDue, OwnerChip, ReasonDialog, StatusSelect, canChange, useToday } from "@/components/action-item-bits";
import { AddItemForm } from "@/components/action-item-form";
import { primaryButton } from "@/components/form";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import type { ActionItemView, ActionStatus, ItemsPayload } from "@/features/action-items/schema";
import { api } from "@/lib/api-client";

interface Props {
  slug: string;
  incidentNumber: number;
  items: ActionItemView[];
  people: Record<string, PersonView>;
  members: PersonView[];
  currentUserId: string;
  isAdmin: boolean;
  onItems: (items: ActionItemView[]) => void;
  onPeople: (people: Record<string, PersonView>) => void;
}

/** This postmortem's action items: status and owner at a glance, and a form to add more (also once published). */
export function ActionItemsPanel({ slug, incidentNumber, items, people, members, currentUserId, isAdmin, onItems, onPeople }: Props) {
  const t = useCopy();
  const r = t.ritual;
  const toast = useToast();
  const today = useToday();
  const [adding, setAdding] = useState(false);
  const [needReason, setNeedReason] = useState<ActionItemView | null>(null);

  const replace = (saved: ActionItemView) => onItems(items.map((i) => (i.id === saved.id ? saved : i)));

  async function changeStatus(item: ActionItemView, status: ActionStatus, reason?: string) {
    if (status === item.status) return;
    if (status === "WONT_DO" && !reason) {
      setNeedReason(item);
      return;
    }
    replace({ ...item, status, wontDoReason: status === "WONT_DO" ? (reason ?? null) : null });
    const result = await api<ItemsPayload>(`/api/w/${slug}/action-items/${item.id}`, {
      method: "PATCH",
      body: { status, ...(reason ? { wontDoReason: reason } : {}) },
    });
    if (!result.ok) {
      replace(item);
      toast.error(result.code === "forbidden" ? r.readOnlyHint : r.toasts.saveFailed);
      return;
    }
    onItems(items.map((i) => (i.id === item.id ? result.data.items[0] : i)));
    onPeople(result.data.people);
  }

  return (
    <section aria-labelledby="action-items-heading" data-testid="action-items-panel" className="space-y-3 rounded border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="action-items-heading" className="text-lg font-semibold">
          {r.editor.heading}
        </h2>
        {!adding && (
          <button type="button" className={primaryButton} onClick={() => setAdding(true)}>
            {r.newRitual}
          </button>
        )}
      </div>

      {items.length === 0 && !adding && <p className="text-sm text-muted">{r.editor.none}</p>}

      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i.id} data-testid={`panel-item-${i.id}`} className="space-y-2 rounded border border-border p-3">
            <p className={`font-medium ${i.status === "DONE" || i.status === "WONT_DO" ? "text-muted line-through" : ""}`}>{i.title}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <OwnerChip person={people[i.ownerId]} small />
              <ActionDue item={i} today={today} />
            </div>
            <StatusSelect
              item={i}
              allowed={canChange(i, currentUserId, isAdmin)}
              label={`${r.fields.status}: ${i.title}`}
              onChange={(s) => void changeStatus(i, s)}
            />
            {i.status === "WONT_DO" && i.wontDoReason && <p className="text-xs text-muted">{i.wontDoReason}</p>}
          </li>
        ))}
      </ul>

      {adding && (
        <AddItemForm
          slug={slug}
          incidentNumber={incidentNumber}
          members={members}
          currentUserId={currentUserId}
          autoFocus
          onCancel={() => setAdding(false)}
          onCreated={(item, p) => {
            onItems([...items, item]);
            onPeople(p);
            toast.success(r.toasts.created);
            setAdding(false);
          }}
        />
      )}

      <ReasonDialog
        open={needReason !== null}
        onConfirm={(reason) => {
          const item = needReason;
          setNeedReason(null);
          if (item) void changeStatus(item, "WONT_DO", reason);
        }}
        onCancel={() => setNeedReason(null)}
      />
    </section>
  );
}
