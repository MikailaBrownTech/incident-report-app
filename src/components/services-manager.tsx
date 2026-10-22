"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { dangerButton, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/form";
import * as rt from "@/components/responsive-table";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import { serviceNameSchema, type ServiceView } from "@/features/services/schema";
import { api } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-messages";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export function ServicesManager({
  slug,
  services,
  canManage,
}: {
  slug: string;
  services: ServiceView[];
  canManage: boolean;
}) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<ServiceView | null>(null);
  const [deleting, setDeleting] = useState<ServiceView | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = serviceNameSchema.safeParse(name);
    if (!parsed.success) {
      setAddError(parsed.error.issues[0]?.message === "too_long" ? t.validation.tooLong(60) : t.validation.required);
      return;
    }
    setAddError(null);
    setAdding(true);
    const result = await api(`/api/w/${slug}/services`, { method: "POST", body: { name: parsed.data } });
    setAdding(false);
    if (!result.ok) {
      if (result.code === "name_taken") setAddError(t.services.nameTaken);
      else toast.error(apiErrorMessage(t, result.code));
      return;
    }
    toast.success(t.services.created);
    setName("");
    router.refresh();
  }

  async function remove(service: ServiceView) {
    setBusy(true);
    const result = await api<{ unlinkedIncidents: number }>(`/api/w/${slug}/services/${service.id}`, {
      method: "DELETE",
    });
    setBusy(false);
    setDeleting(null);
    if (!result.ok) toast.error(apiErrorMessage(t, result.code));
    else toast.success(t.services.deleted(result.data.unlinkedIncidents));
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <form onSubmit={add} noValidate className="flex max-w-xl flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor="service-name" className={labelClass}>
              {t.services.nameLabel}
            </label>
            <input
              id="service-name"
              value={name}
              maxLength={80}
              placeholder={t.services.namePlaceholder}
              onChange={(e) => {
                setName(e.target.value);
                if (addError) setAddError(null);
              }}
              aria-invalid={Boolean(addError)}
              aria-describedby={addError ? "service-name-error" : undefined}
              className={inputClass}
            />
            {addError ? (
              <p id="service-name-error" className="mt-1 text-sm text-danger">
                {addError}
              </p>
            ) : null}
          </div>
          <button type="submit" disabled={adding} className={`${primaryButton} mt-6`}>
            {adding ? t.services.adding : t.services.add}
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">{t.services.readOnlyNote}</p>
      )}

      {services.length === 0 ? (
        <EmptyState message={t.services.empty} />
      ) : (
        <div className={rt.tableWrap}>
          <table role="table" className={rt.table}>
            <caption className="sr-only">{t.services.heading}</caption>
            <thead role="rowgroup" className={rt.thead}>
              <tr role="row">
                <th role="columnheader" scope="col" className={rt.th}>
                  {t.services.colName}
                </th>
                <th role="columnheader" scope="col" className={rt.th}>
                  {t.services.colSlug}
                </th>
                <th role="columnheader" scope="col" className={rt.th}>
                  {t.services.colOpen}
                </th>
                <th role="columnheader" scope="col" className={rt.th}>
                  {t.services.colCreated}
                </th>
                {canManage ? (
                  <th role="columnheader" scope="col" className={rt.th}>
                    {t.services.colActions}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody role="rowgroup" className={rt.tbody}>
              {services.map((s) => (
                <tr key={s.id} role="row" data-testid={`service-${s.slug}`} className={rt.tr}>
                  <td role="cell" className={`${rt.td} font-medium`}>
                    {s.name}
                  </td>
                  <td role="cell" data-label={t.services.colSlug} className={`${rt.td} font-mono text-muted`}>
                    {s.slug}
                  </td>
                  <td role="cell" data-label={t.services.colOpen} className={rt.td}>
                    {s.openIncidents}
                  </td>
                  <td role="cell" data-label={t.services.colCreated} className={`${rt.td} text-muted`}>
                    {formatDate(s.createdAt)}
                  </td>
                  {canManage ? (
                    <td role="cell" data-label={t.services.colActions} className={rt.td}>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={secondaryButton} onClick={() => setRenaming(s)}>
                          {t.services.rename}
                        </button>
                        <button type="button" className={dangerButton} onClick={() => setDeleting(s)}>
                          {t.services.delete}
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RenameDialog
        slug={slug}
        service={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => {
          setRenaming(null);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t.services.deleteConfirmTitle(deleting?.name ?? "")}
        body={
          deleting && deleting.totalIncidents > 0
            ? t.services.deleteConfirmLinked(deleting.totalIncidents)
            : t.services.deleteConfirmNone
        }
        confirmLabel={t.services.delete}
        pending={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />
    </div>
  );
}

function RenameDialog({
  slug,
  service,
  onClose,
  onRenamed,
}: {
  slug: string;
  service: ServiceView | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const t = useCopy();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const open = service !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="rename-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(92vw,26rem)] rounded border border-border bg-surface p-5 text-fg backdrop:bg-black/60"
    >
      {/* keyed by service so the field restarts from the current name each time */}
      {service ? (
        <RenameForm
          key={service.id}
          slug={slug}
          service={service}
          onClose={onClose}
          onRenamed={onRenamed}
          toastError={toast.error}
          toastSuccess={toast.success}
        />
      ) : (
        <h2 id="rename-title" className="sr-only">
          {t.services.rename}
        </h2>
      )}
    </dialog>
  );
}

function RenameForm({
  slug,
  service,
  onClose,
  onRenamed,
  toastError,
  toastSuccess,
}: {
  slug: string;
  service: ServiceView;
  onClose: () => void;
  onRenamed: () => void;
  toastError: (m: string) => void;
  toastSuccess: (m: string) => void;
}) {
  const t = useCopy();
  const [name, setName] = useState(service.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = serviceNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message === "too_long" ? t.validation.tooLong(60) : t.validation.required);
      return;
    }
    setError(null);
    setPending(true);
    const result = await api(`/api/w/${slug}/services/${service.id}`, { method: "PATCH", body: { name: parsed.data } });
    setPending(false);
    if (!result.ok) {
      if (result.code === "name_taken") setError(t.services.nameTaken);
      else toastError(apiErrorMessage(t, result.code));
      return;
    }
    toastSuccess(t.services.renamed);
    onRenamed();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <h2 id="rename-title" className="text-lg font-semibold">
        {t.services.rename}
      </h2>
      <div>
        <label htmlFor="rename-input" className={labelClass}>
          {t.services.nameLabel}
        </label>
        <input
          id="rename-input"
          value={name}
          maxLength={80}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "rename-error" : undefined}
          className={inputClass}
        />
        {error ? (
          <p id="rename-error" className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={pending}>
          {t.actions.cancel}
        </button>
        <button type="submit" className={primaryButton} disabled={pending}>
          {t.services.save}
        </button>
      </div>
    </form>
  );
}
