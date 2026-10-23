"use client";

import Link from "next/link";
import { AlertTriangle, Clock, MessageSquareText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { primaryButton, secondaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import { STATUSES, type ActionItemView, type ActionStatus } from "@/features/action-items/schema";
import { getActionItemState, localDay } from "@/features/action-items/state";

/** The viewer's own calendar day, refreshed every minute so cards tip over at midnight without a reload. */
export function useToday(initial?: string): string {
  // the server's date (when given) is only the first guess; the viewer's local date takes over on the first tick
  const [today, setToday] = useState(initial ?? localDay());
  useEffect(() => {
    const id = setInterval(() => setToday(localDay()), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

export const canChange = (item: Pick<ActionItemView, "ownerId">, userId: string, isAdmin: boolean) =>
  isAdmin || item.ownerId === userId;

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Due date with its state: overdue in red with "3d late" and an icon, due soon in amber, never colour alone. */
export function ActionDue({ item, today }: { item: Pick<ActionItemView, "status" | "dueDate">; today: string }) {
  const t = useCopy().ritual;
  const { state, daysLate, daysUntil } = getActionItemState(item, today);
  if (!item.dueDate) return state === "NO_DATE" ? <span className="text-xs text-muted">{t.noDate}</span> : null;
  const exact = shortDate(item.dueDate);
  if (state === "OVERDUE") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-semibold text-danger"
        title={exact}
        suppressHydrationWarning
      >
        <AlertTriangle aria-hidden="true" className="size-3.5" />
        <span className="sr-only">{`${t.states.OVERDUE}: `}</span>
        {t.daysLate(daysLate)}
      </span>
    );
  }
  if (state === "DUE_SOON") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-medium text-warning"
        title={exact}
        suppressHydrationWarning
      >
        <Clock aria-hidden="true" className="size-3.5" />
        <span className="sr-only">{`${t.states.DUE_SOON}: `}</span>
        {daysUntil === 0 ? t.dueToday : t.dueIn(daysUntil ?? 0)}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted" title={exact} suppressHydrationWarning>
      {exact}
    </span>
  );
}

export function OwnerChip({ person, small = false }: { person: PersonView | undefined; small?: boolean }) {
  const t = useCopy();
  const name = person?.name || person?.email || t.timeline.actorFormerMember;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className={small ? "[&>*]:size-6 [&>*]:text-xs" : ""}>
        <Avatar name={name} image={person?.image ?? null} />
      </span>
      <span className="truncate text-sm">{name}</span>
    </span>
  );
}

const SEVERITY_BORDER: Record<number, string> = {
  1: "border-sev-1 text-fg",
  2: "border-sev-2 text-fg",
  3: "border-sev-3 text-fg",
  4: "border-sev-4 text-fg",
  5: "border-sev-5 border-2 text-fg font-semibold",
};

/** INC-42, linking to the incident, tinted by severity (the number is the text, so colour is never the only cue). */
export function IncidentChip({
  slug,
  incident,
}: {
  slug: string;
  incident: { number: number; severity: number; title: string };
}) {
  const t = useCopy();
  return (
    <Link
      href={`/app/${slug}/incidents/${incident.number}`}
      title={incident.title}
      data-severity={incident.severity}
      className={`inline-block rounded-tag border px-2 py-0.5 text-xs hover:underline ${SEVERITY_BORDER[incident.severity] ?? SEVERITY_BORDER[1]}`}
    >
      {t.incident.number(incident.number)}
    </Link>
  );
}

export const HasDescription = () => {
  const t = useCopy().ritual;
  return (
    <span title={t.hasDescription} className="text-muted">
      <MessageSquareText aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{t.hasDescription}</span>
    </span>
  );
};

/** A status dropdown that is disabled, with a reason in the tooltip, for people who can't change the item. */
export function StatusSelect({
  item,
  allowed,
  onChange,
  label,
  className = "",
}: {
  item: Pick<ActionItemView, "status">;
  allowed: boolean;
  onChange: (status: ActionStatus) => void;
  label: string;
  className?: string;
}) {
  const t = useCopy().ritual;
  return (
    <select
      aria-label={label}
      value={item.status}
      disabled={!allowed}
      title={allowed ? undefined : t.readOnlyHint}
      onChange={(e) => onChange(e.target.value as ActionStatus)}
      className={`rounded border border-border bg-surface px-2 py-1 text-sm disabled:opacity-60 ${className}`}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {t.statusLabel[s]}
        </option>
      ))}
    </select>
  );
}

/** Asked before an item is marked "won't do": the reason is required and travels with the change. */
export function ReasonDialog({
  open,
  initial = "",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  initial?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const copy = useCopy();
  const t = copy.ritual;
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState(initial);
  const [error, setError] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason(initial);
      setError(false);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initial]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="reason-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,26rem)] rounded-pop border shadow-pop border-border bg-surface p-5 text-fg backdrop:bg-ground/70"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) {
            setError(true);
            return;
          }
          onConfirm(reason.trim());
        }}
        noValidate
      >
        <h2 id="reason-title" className="text-lg font-semibold">
          {t.reasonTitle}
        </h2>
        <p className="mt-1 text-sm text-muted">{t.reasonBody}</p>
        <label htmlFor="wont-do-reason" className="mt-3 block text-sm font-medium">
          {t.fields.reason}
        </label>
        <textarea
          id="wont-do-reason"
          value={reason}
          rows={3}
          maxLength={500}
          autoFocus
          placeholder={t.placeholders.reason}
          aria-invalid={error}
          aria-describedby={error ? "wont-do-reason-error" : undefined}
          onChange={(e) => {
            setReason(e.target.value);
            setError(false);
          }}
          className="mt-1 w-full rounded border border-border bg-surface px-3 py-2"
        />
        {error && (
          <p id="wont-do-reason-error" role="alert" className="mt-1 text-sm text-danger">
            {t.reasonRequired}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onCancel}>
            {copy.actions.cancel}
          </button>
          <button type="submit" className={primaryButton}>
            {t.reasonConfirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
