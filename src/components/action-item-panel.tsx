"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IncidentChip } from "@/components/action-item-bits";
import { dangerButton, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import { STATUSES, type ActionItemView, type ActionStatus } from "@/features/action-items/schema";

export interface PanelChanges {
  title?: string;
  description?: string;
  ownerId?: string;
  dueDate?: string | null;
  status?: ActionStatus;
  wontDoReason?: string;
}

interface Props {
  slug: string;
  item: ActionItemView | null;
  people: Record<string, PersonView>;
  members: PersonView[];
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  /** Resolves true when saved (the panel closes), false to stay open with the draft. */
  onSave: (item: ActionItemView, changes: PanelChanges) => Promise<boolean>;
  onDelete: (item: ActionItemView) => Promise<boolean>;
}

/** A drawer to edit every field of one item. Read-only (with the reason why) for people who can't change it. */
export function ActionItemPanel({ slug, item, people, members, canEdit, canDelete, onClose, onSave, onDelete }: Props) {
  const t = useCopy();
  const r = t.ritual;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="item-panel-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-[min(100vw,28rem)] border-l border-border shadow-pop bg-surface p-5 text-fg backdrop:bg-ground/70"
    >
      {item && (
        <PanelBody
          key={item.id}
          slug={slug}
          item={item}
          people={people}
          members={members}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
          r={r}
          closeLabel={r.panel.close}
          cancelLabel={t.actions.cancel}
          requiredLabel={t.validation.required}
        />
      )}
    </dialog>
  );
}

function PanelBody({
  slug,
  item,
  people,
  members,
  canEdit,
  canDelete,
  onClose,
  onSave,
  onDelete,
  r,
  closeLabel,
  cancelLabel,
  requiredLabel,
}: Props & {
  item: ActionItemView;
  r: ReturnType<typeof useCopy>["ritual"];
  closeLabel: string;
  cancelLabel: string;
  requiredLabel: string;
}) {
  const id = useId();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [ownerId, setOwnerId] = useState(item.ownerId);
  const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const [status, setStatus] = useState<ActionStatus>(item.status);
  const [reason, setReason] = useState(item.wontDoReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const creator = people[item.createdById];
  const disabled = !canEdit || pending;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError(requiredLabel);
      return;
    }
    if (status === "WONT_DO" && !reason.trim()) {
      setError(r.reasonRequired);
      return;
    }
    const changes: PanelChanges = {};
    if (title.trim() !== item.title) changes.title = title.trim();
    if (description.trim() !== item.description) changes.description = description.trim();
    if (ownerId !== item.ownerId) changes.ownerId = ownerId;
    if ((dueDate || null) !== item.dueDate) changes.dueDate = dueDate || null;
    if (status !== item.status) changes.status = status;
    if (status === "WONT_DO" && reason.trim() !== (item.wontDoReason ?? "")) changes.wontDoReason = reason.trim();
    if (status === "WONT_DO" && changes.status && !changes.wontDoReason) changes.wontDoReason = reason.trim();
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setPending(true);
    setError(null);
    const ok = await onSave(item, changes);
    setPending(false);
    if (!ok) setError(r.toasts.saveFailed);
  }

  return (
    <form onSubmit={save} noValidate className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <h2 id="item-panel-title" className="text-lg font-semibold">
          {r.panel.title}
        </h2>
        <button type="button" className={secondaryButton} onClick={onClose}>
          {closeLabel}
        </button>
      </div>

      {!canEdit && (
        <p role="note" className="rounded border border-border p-2 text-sm text-muted">
          {r.readOnlyHint}
        </p>
      )}

      <div>
        <label htmlFor={`${id}-title`} className={labelClass}>
          {r.fields.title}
        </label>
        <input
          id={`${id}-title`}
          value={title}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-desc`} className={labelClass}>
          {r.fields.description}
        </label>
        <textarea
          id={`${id}-desc`}
          rows={4}
          value={description}
          maxLength={5000}
          disabled={disabled}
          placeholder={r.placeholders.description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-owner`} className={labelClass}>
            {r.fields.owner}
          </label>
          <select
            id={`${id}-owner`}
            value={ownerId}
            disabled={disabled}
            onChange={(e) => setOwnerId(e.target.value)}
            className={inputClass}
          >
            {!members.some((m) => m.userId === item.ownerId) && (
              <option value={item.ownerId}>{people[item.ownerId]?.name || r.unassigned}</option>
            )}
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-due`} className={labelClass}>
            {r.fields.dueDate}
          </label>
          <input
            id={`${id}-due`}
            type="date"
            value={dueDate}
            disabled={disabled}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-status`} className={labelClass}>
          {r.fields.status}
        </label>
        <select
          id={`${id}-status`}
          value={status}
          disabled={disabled}
          onChange={(e) => setStatus(e.target.value as ActionStatus)}
          className={inputClass}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {r.statusLabel[s]}
            </option>
          ))}
        </select>
      </div>
      {status === "WONT_DO" && (
        <div>
          <label htmlFor={`${id}-reason`} className={labelClass}>
            {r.fields.reason}
          </label>
          <textarea
            id={`${id}-reason`}
            rows={2}
            value={reason}
            disabled={disabled}
            placeholder={r.placeholders.reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          />
        </div>
      )}

      <dl className="space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-muted">{r.panel.incident}</dt>
          <dd className="flex items-center gap-2">
            <IncidentChip slug={slug} incident={item.incident} />
            <span className="truncate">{item.incident.title}</span>
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-muted">{r.panel.postmortem}</dt>
          <dd>
            <Link href={`/app/${slug}/incidents/${item.incident.number}/postmortem`} className="text-accent underline">
              {r.card.viewPostmortem}
            </Link>
          </dd>
        </div>
        {creator && <p className="text-muted">{r.panel.createdBy(creator.name || creator.email)}</p>}
      </dl>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex gap-2">
          <button type="submit" className={primaryButton} disabled={disabled}>
            {pending ? r.saving : r.save}
          </button>
          <button type="button" className={secondaryButton} onClick={onClose} disabled={pending}>
            {cancelLabel}
          </button>
        </div>
        <button
          type="button"
          className={dangerButton}
          disabled={!canDelete || pending}
          title={canDelete ? undefined : r.deleteOnlyAdmins}
          onClick={() => setConfirmDelete(true)}
        >
          {r.delete}
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={r.deleteConfirmTitle}
        body={r.deleteConfirmBody}
        confirmLabel={r.delete}
        pending={pending}
        onConfirm={async () => {
          setPending(true);
          const ok = await onDelete(item);
          setPending(false);
          setConfirmDelete(false);
          if (!ok) setError(r.toasts.saveFailed);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}
