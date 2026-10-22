"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { inputClass, labelClass, primaryButton, secondaryButton } from "@/components/form";
import { ServicePicker, type PickerService } from "@/components/service-picker";
import { useToast } from "@/components/toast";
import { severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import { api } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/api-messages";
import { toLocalInput } from "@/lib/time";

const LEVELS: SeverityLevel[] = [1, 2, 3, 4, 5];
const STATUSES = ["INVESTIGATING", "IDENTIFIED", "MITIGATING"] as const;

interface DeclareContextValue {
  open: () => void;
}
const DeclareContext = createContext<DeclareContextValue | null>(null);

export function useDeclareIncident(): DeclareContextValue {
  const ctx = useContext(DeclareContext);
  if (!ctx) throw new Error("useDeclareIncident must be used inside <DeclareIncidentProvider>");
  return ctx;
}

interface ProviderProps {
  slug: string;
  services: PickerService[];
  canCreateServices: boolean;
  severityLabels: SeverityOverrides;
  children: ReactNode;
}

/** Owns the "Declare incident" dialog, so any button (and the `c` shortcut) can open it. */
export function DeclareIncidentProvider({ children, ...props }: ProviderProps) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      // Never steal the key while typing, or while another dialog is open.
      if (target?.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <DeclareContext.Provider value={value}>
      {children}
      <DeclareDialog open={open} onClose={() => setOpen(false)} {...props} />
    </DeclareContext.Provider>
  );
}

export function DeclareIncidentButton() {
  const t = useCopy();
  const { open } = useDeclareIncident();
  return (
    <button
      type="button"
      onClick={open}
      aria-keyshortcuts="c"
      data-testid="declare-incident"
      className={`${primaryButton} inline-flex items-center gap-2`}
    >
      {t.declare.button}
      <kbd aria-hidden="true" className="rounded border border-accent-fg/40 px-1.5 text-xs">
        {"C"}
      </kbd>
    </button>
  );
}

function DeclareDialog({
  open,
  onClose,
  ...props
}: Omit<ProviderProps, "children"> & { open: boolean; onClose: () => void }) {
  const t = useCopy();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="declare-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[92vh] w-[min(94vw,40rem)] overflow-auto rounded border border-border bg-surface p-5 text-fg backdrop:bg-black/60"
    >
      <h2 id="declare-title" className="mb-4 text-xl font-semibold">
        {t.declare.dialogTitle}
      </h2>
      {/* Mounted only while open, so every opening starts from a clean form with "now" as the start time. */}
      {open ? <DeclareForm onClose={onClose} {...props} /> : null}
    </dialog>
  );
}

type FieldErrors = Partial<Record<"title" | "startedAt" | "services" | "summary", string>>;

function DeclareForm({
  onClose,
  slug,
  services,
  canCreateServices,
  severityLabels,
}: Omit<ProviderProps, "children"> & { onClose: () => void }) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [now] = useState(() => new Date());
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState<SeverityLevel>(3);
  const [picked, setPicked] = useState<{ selectedIds: string[]; newNames: string[] }>({
    selectedIds: [],
    newNames: [],
  });
  const [startedAt, setStartedAt] = useState(() => toLocalInput(now));
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("INVESTIGATING");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: FieldErrors = {};
    if (!title.trim()) found.title = t.validation.required;
    else if (title.trim().length > 140) found.title = t.validation.tooLong(140);
    const started = new Date(startedAt);
    if (!startedAt || Number.isNaN(started.getTime())) found.startedAt = t.validation.required;
    else if (started.getTime() > Date.now() + 5 * 60_000) found.startedAt = t.declare.startedInFuture;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setPending(true);
    const result = await api<{ incident: { number: number } }>(`/api/w/${slug}/incidents`, {
      method: "POST",
      body: {
        title: title.trim(),
        summary: summary.trim(),
        severity,
        serviceIds: picked.selectedIds,
        newServiceNames: picked.newNames,
        startedAt: started.toISOString(),
        status,
      },
    });
    if (!result.ok) {
      setPending(false);
      const fe = result.fieldErrors ?? {};
      if (fe.title)
        setErrors({ title: fe.title[0] === "too_long" ? t.validation.tooLong(140) : t.validation.required });
      else if (fe.startedAt) setErrors({ startedAt: t.declare.startedInFuture });
      else if (fe.serviceIds) setErrors({ services: t.declare.invalidService });
      else if (fe.newServiceNames) setErrors({ services: t.declare.serviceNameTaken });
      else if (fe.summary) setErrors({ summary: t.validation.tooLong(20000) });
      else if (result.code === "forbidden") setErrors({ services: t.declare.createServiceForbidden });
      else toast.error(apiErrorMessage(t, result.code));
      return;
    }
    toast.success(t.declare.created(t.incident.number(result.data.incident.number)));
    onClose();
    if (picked.newNames.length > 0) router.refresh(); // the services list in the shell changed
    router.push(`/app/${slug}/incidents/${result.data.incident.number}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="declare-title-input" className={labelClass}>
          {t.declare.titleLabel}
        </label>
        <input
          id="declare-title-input"
          value={title}
          maxLength={160}
          autoFocus
          placeholder={t.declare.titlePlaceholder}
          onChange={(e) => {
            setTitle(e.target.value);
            if (errors.title) setErrors({ ...errors, title: undefined });
          }}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? "declare-title-error" : undefined}
          className={inputClass}
        />
        {errors.title ? (
          <p id="declare-title-error" className="mt-1 text-sm text-danger">
            {errors.title}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="declare-summary" className={labelClass}>
          {t.declare.summaryLabel}
        </label>
        <textarea
          id="declare-summary"
          rows={4}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-describedby="declare-summary-help"
          className={`${inputClass} font-mono text-sm`}
        />
        <p id="declare-summary-help" className="mt-1 text-sm text-muted">
          {errors.summary ?? t.declare.summaryHelp}
        </p>
      </div>

      <fieldset>
        <legend className={labelClass}>{t.declare.severityLabel}</legend>
        <div className="grid grid-cols-5 gap-1.5">
          {LEVELS.map((level) => (
            <div key={level} className="relative">
              <input
                type="radio"
                id={`declare-sev-${level}`}
                name="severity"
                checked={severity === level}
                onChange={() => setSeverity(level)}
                className="peer sr-only"
              />
              <label
                htmlFor={`declare-sev-${level}`}
                className="flex h-full cursor-pointer flex-col items-center gap-0.5 rounded border border-border bg-bg px-1 py-2 text-center text-xs peer-checked:border-accent peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-accent-fg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent"
              >
                <span className="text-base font-semibold">{level}</span>
                <span className="break-words">{severityName(t, level, severityLabels)}</span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <ServicePicker
        services={services}
        selectedIds={picked.selectedIds}
        newNames={picked.newNames}
        canCreate={canCreateServices}
        error={errors.services}
        onChange={(next) => {
          setPicked(next);
          if (errors.services) setErrors({ ...errors, services: undefined });
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="declare-started" className={labelClass}>
            {t.declare.startedAtLabel}
          </label>
          <input
            id="declare-started"
            type="datetime-local"
            value={startedAt}
            max={toLocalInput(now)}
            onChange={(e) => {
              setStartedAt(e.target.value);
              if (errors.startedAt) setErrors({ ...errors, startedAt: undefined });
            }}
            aria-invalid={Boolean(errors.startedAt)}
            aria-describedby="declare-started-help"
            className={inputClass}
          />
          <p id="declare-started-help" className={`mt-1 text-sm ${errors.startedAt ? "text-danger" : "text-muted"}`}>
            {errors.startedAt ?? t.declare.startedAtHelp}
          </p>
        </div>
        <div>
          <label htmlFor="declare-status" className={labelClass}>
            {t.declare.statusLabel}
          </label>
          <select
            id="declare-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
            className={inputClass}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.status[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={pending}>
          {t.actions.cancel}
        </button>
        <button type="submit" className={primaryButton} disabled={pending}>
          {pending ? t.declare.submitting : t.declare.submit}
        </button>
      </div>
    </form>
  );
}
