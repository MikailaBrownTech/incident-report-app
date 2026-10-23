"use client";

import { useEffect, useId, useRef } from "react";
import { dangerButton, secondaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Destructive-action confirmation on the native <dialog>: focus is trapped and Esc cancels. */
export function ConfirmDialog({ open, title, body, confirmLabel, pending, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useCopy();
  const ref = useRef<HTMLDialogElement>(null);
  // unique per dialog: several can be on one page, and a shared id would point them all at the first one's text
  const uid = useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto w-[min(92vw,26rem)] rounded border border-border bg-surface p-5 text-fg backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <p id={bodyId} className="mt-2 text-sm text-muted">
        {body}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onCancel} disabled={pending}>
          {t.actions.cancel}
        </button>
        <button type="button" className={dangerButton} onClick={onConfirm} disabled={pending} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
