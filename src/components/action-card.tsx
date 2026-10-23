"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ActionDue, HasDescription, IncidentChip, OwnerChip } from "@/components/action-item-bits";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import { STATUSES, type ActionItemView, type ActionStatus } from "@/features/action-items/schema";
import { getActionItemState } from "@/features/action-items/state";

interface Props {
  item: ActionItemView;
  slug: string;
  people: Record<string, PersonView>;
  today: string;
  /** Owner or admin: may drag, and use the menu. */
  editable: boolean;
  onOpen: (item: ActionItemView) => void;
  onMoveTo: (item: ActionItemView, status: ActionStatus) => void;
  /** Rendered in the drag overlay: no handlers, no sortable. */
  overlay?: boolean;
}

/** One card. Draggable by its handle (pointer or keyboard); every card also has a "Move to" menu. */
export function ActionCard(props: Props) {
  const { item, slug, people, today, editable, onOpen, onMoveTo, overlay = false } = props;
  const t = useCopy();
  const r = t.ritual;
  const sortable = useSortable({ id: item.id, disabled: !editable || overlay });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const { state } = getActionItemState(item, today);

  return (
    <li
      ref={overlay ? undefined : setNodeRef}
      data-testid={`card-${item.id}`}
      data-state={state}
      style={overlay ? undefined : { transform: CSS.Transform.toString(transform), transition }}
      className={`space-y-2 rounded border bg-surface p-3 ${state === "OVERDUE" ? "border-danger" : "border-border"} ${
        isDragging ? "opacity-40" : ""
      } ${overlay ? "shadow-pop" : ""}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={`${r.board.dragCard}: ${item.title}`}
          title={editable ? r.board.dragCard : r.readOnlyHint}
          disabled={!editable}
          className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
          {...(overlay ? {} : attributes)}
          {...(overlay || !editable ? {} : listeners)}
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left font-medium hover:underline"
          onClick={() => onOpen(item)}
        >
          {item.title}
        </button>
        {item.description && <HasDescription />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <IncidentChip slug={slug} incident={item.incident} />
        <ActionDue item={item} today={today} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <OwnerChip person={people[item.ownerId]} small />
        <label className="sr-only" htmlFor={`move-${item.id}`}>
          {`${r.moveTo}: ${item.title}`}
        </label>
        <select
          id={`move-${item.id}`}
          value=""
          disabled={!editable}
          title={editable ? undefined : r.readOnlyHint}
          onChange={(e) => e.target.value && onMoveTo(item, e.target.value as ActionStatus)}
          className="max-w-32 rounded border border-border bg-bg px-1.5 py-1 text-xs disabled:opacity-50"
        >
          <option value="">{r.moveTo}</option>
          {STATUSES.filter((s) => s !== item.status).map((s) => (
            <option key={s} value={s}>
              {r.moveToStatus(r.statusLabel[s])}
            </option>
          ))}
        </select>
      </div>
      {item.status === "WONT_DO" && item.wontDoReason && <p className="text-xs text-muted">{item.wontDoReason}</p>}
    </li>
  );
}
