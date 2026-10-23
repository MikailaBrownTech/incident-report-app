"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  ActionDue,
  IncidentChip,
  ReasonDialog,
  StatusSelect,
  canChange,
  useToday,
} from "@/components/action-item-bits";
import { ActionItemPanel, type PanelChanges } from "@/components/action-item-panel";
import { EmptyState } from "@/components/empty-state";
import { secondaryButton } from "@/components/form";
import * as rt from "@/components/responsive-table";
import { useToast } from "@/components/toast";
import { emptyMessage } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import type { ActionItemView, ActionStatus, ItemsPayload } from "@/features/action-items/schema";
import { addDays, getActionItemState } from "@/features/action-items/state";
import { api } from "@/lib/api-client";

interface Props {
  slug: string;
  items: ActionItemView[];
  doneRecently: ActionItemView[];
  people: Record<string, PersonView>;
  members: PersonView[];
  currentUserId: string;
  isAdmin: boolean;
}

type Group = "overdue" | "dueThisWeek" | "later" | "noDate";

export function ActionItemsMine({
  slug,
  items: initial,
  doneRecently,
  people: initialPeople,
  members,
  currentUserId,
  isAdmin,
}: Props) {
  const t = useCopy();
  const r = t.ritual;
  const toast = useToast();
  const today = useToday();
  const [items, setItems] = useState<ActionItemView[]>([...initial, ...doneRecently]);
  const [people, setPeople] = useState(initialPeople);
  const [openId, setOpenId] = useState<string | null>(null);
  const [needReason, setNeedReason] = useState<ActionItemView | null>(null);

  const replace = useCallback(
    (saved: ActionItemView) => setItems((cur) => cur.map((i) => (i.id === saved.id ? saved : i))),
    [],
  );

  async function patch(
    item: ActionItemView,
    body: Record<string, unknown>,
    optimistic: Partial<ActionItemView>,
  ): Promise<boolean> {
    const before = item;
    replace({ ...item, ...optimistic });
    const result = await api<ItemsPayload>(`/api/w/${slug}/action-items/${item.id}`, { method: "PATCH", body });
    if (!result.ok) {
      replace(before);
      toast.error(result.code === "forbidden" ? r.readOnlyHint : r.toasts.saveFailed);
      return false;
    }
    replace(result.data.items[0]);
    setPeople((p) => ({ ...p, ...result.data.people }));
    return true;
  }

  async function changeStatus(item: ActionItemView, status: ActionStatus, reason?: string) {
    if (status === item.status) return;
    if (status === "WONT_DO" && !reason) {
      setNeedReason(item);
      return;
    }
    const ok = await patch(
      item,
      { status, ...(reason ? { wontDoReason: reason } : {}) },
      {
        status,
        completedAt: status === "DONE" ? new Date().toISOString() : null,
        wontDoReason: status === "WONT_DO" ? (reason ?? null) : null,
      },
    );
    if (ok && status === "DONE") {
      toast.success(r.toasts.completed(item.title), {
        label: r.toasts.undo,
        onClick: () =>
          void patch({ ...item, status: "DONE" }, { status: item.status }, { status: item.status, completedAt: null }),
      });
    }
  }

  async function savePanel(item: ActionItemView, changes: PanelChanges) {
    const result = await api<ItemsPayload>(`/api/w/${slug}/action-items/${item.id}`, {
      method: "PATCH",
      body: changes,
    });
    if (!result.ok) return false;
    replace(result.data.items[0]);
    setPeople((p) => ({ ...p, ...result.data.people }));
    toast.success(r.toasts.saved);
    setOpenId(null);
    return true;
  }

  async function deleteItem(item: ActionItemView) {
    const result = await api(`/api/w/${slug}/action-items/${item.id}`, { method: "DELETE" });
    if (!result.ok) return false;
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    toast.success(r.toasts.deleted);
    setOpenId(null);
    return true;
  }

  const open = items.filter((i) => i.status === "OPEN" || i.status === "IN_PROGRESS");
  const done = items.filter((i) => i.status === "DONE");
  const groups: Record<Group, ActionItemView[]> = { overdue: [], dueThisWeek: [], later: [], noDate: [] };
  const weekEnd = addDays(today, 7);
  for (const i of open) {
    const { state } = getActionItemState(i, today);
    if (state === "OVERDUE") groups.overdue.push(i);
    else if (state === "NO_DATE") groups.noDate.push(i);
    else if (i.dueDate && i.dueDate <= weekEnd) groups.dueThisWeek.push(i);
    else groups.later.push(i);
  }
  const byDue = (a: ActionItemView, b: ActionItemView) =>
    (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.id.localeCompare(b.id);
  const openItem = openId ? (items.find((i) => i.id === openId) ?? null) : null;

  if (open.length === 0 && done.length === 0) {
    return <EmptyState message={r.mineEmpty || emptyMessage(t, "myRituals")} />;
  }

  const row = (i: ActionItemView) => {
    const editable = canChange(i, currentUserId, isAdmin);
    return (
      <tr key={i.id} role="row" data-testid={`mine-${i.id}`} className={rt.tr}>
        <td role="cell" data-label={r.fields.title} className={`${rt.td} min-w-48 font-medium`}>
          <button type="button" className="text-left hover:underline" onClick={() => setOpenId(i.id)}>
            {i.title}
          </button>
        </td>
        <td role="cell" data-label={r.fields.incident} className={rt.td}>
          <IncidentChip slug={slug} incident={i.incident} />
        </td>
        <td role="cell" data-label={r.fields.dueDate} className={`${rt.td} whitespace-nowrap`}>
          <div className="flex flex-wrap items-center gap-2">
            <ActionDue item={i} today={today} />
            <input
              type="date"
              aria-label={`${r.fields.dueDate}: ${i.title}`}
              value={i.dueDate ?? ""}
              disabled={!editable}
              title={editable ? undefined : r.readOnlyHint}
              onChange={(e) => void patch(i, { dueDate: e.target.value || null }, { dueDate: e.target.value || null })}
              className="w-36 rounded border border-border bg-bg px-1.5 py-1 text-xs disabled:opacity-50"
            />
          </div>
        </td>
        <td role="cell" data-label={r.fields.status} className={rt.td}>
          <StatusSelect
            item={i}
            allowed={editable}
            label={`${r.fields.status}: ${i.title}`}
            onChange={(s) => void changeStatus(i, s)}
          />
        </td>
        <td role="cell" data-label={r.panel.postmortem} className={rt.td}>
          <Link
            href={`/app/${slug}/incidents/${i.incident.number}/postmortem`}
            className="text-sm text-accent underline"
          >
            {r.card.viewPostmortem}
          </Link>
        </td>
      </tr>
    );
  };

  const table = (list: ActionItemView[], label: string) => (
    <div className={rt.tableWrap}>
      <table role="table" className={rt.table}>
        <caption className="sr-only">{label}</caption>
        <thead role="rowgroup" className={rt.thead}>
          <tr role="row">
            {[r.fields.title, r.fields.incident, r.fields.dueDate, r.fields.status, r.panel.postmortem].map((h) => (
              <th key={h} role="columnheader" scope="col" className={rt.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className={rt.tbody}>
          {list.map(row)}
        </tbody>
      </table>
    </div>
  );

  const heading = (group: Group, label: string) => (
    <h2 className={`text-lg font-semibold ${group === "overdue" ? "text-danger" : ""}`}>
      {`${label} (${groups[group].length})`}
    </h2>
  );

  return (
    <div className="space-y-6">
      {(["overdue", "dueThisWeek", "later", "noDate"] as const).map((g) =>
        groups[g].length === 0 ? null : (
          <section
            key={g}
            aria-label={r.mineGroups[g]}
            data-group={g}
            className={`space-y-2 ${g === "overdue" ? "rounded border border-danger p-3" : ""}`}
          >
            {heading(g, r.mineGroups[g])}
            {table([...groups[g]].sort(byDue), r.mineGroups[g])}
          </section>
        ),
      )}
      {done.length > 0 && (
        <details data-group="doneRecently" className="space-y-2">
          <summary
            className={`${secondaryButton} inline-block cursor-pointer`}
          >{`${r.mineGroups.doneRecently} (${done.length})`}</summary>
          <div className="mt-2">{table(done, r.mineGroups.doneRecently)}</div>
        </details>
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
      <ActionItemPanel
        slug={slug}
        item={openItem}
        people={people}
        members={members}
        canEdit={openItem ? canChange(openItem, currentUserId, isAdmin) : false}
        canDelete={isAdmin}
        onClose={() => setOpenId(null)}
        onSave={savePanel}
        onDelete={deleteItem}
      />
    </div>
  );
}
