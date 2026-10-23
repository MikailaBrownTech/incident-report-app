"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { primaryButton, secondaryButton } from "@/components/form";
import { PostmortemBadge } from "@/components/postmortem-badge";
import { useToast } from "@/components/toast";
import { useCopy } from "@/copy/provider";
import { defaultTemplateIdFor, type TemplateView } from "@/features/postmortems/sections";
import { daysOverdue, daysUntil, getPostmortemStatus, type RuleLike } from "@/features/postmortems/status";
import { api } from "@/lib/api-client";

interface Props {
  slug: string;
  incident: { number: number; severity: number; status: string; resolvedAt: string | null };
  postmortemStatus: "DRAFT" | "PUBLISHED" | null;
  rules: RuleLike[];
  templates: TemplateView[];
}

/**
 * The postmortem's place on the incident page: whether one is required and when, and the way to start, continue or read
 * it. It is computed from the live incident, so resolving or reopening here updates it straight away.
 */
export function PostmortemPanel({ slug, incident, postmortemStatus, rules, templates }: Props) {
  const t = useCopy();
  const p = t.postmortem;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const status = getPostmortemStatus(incident, rules, postmortemStatus ? { status: postmortemStatus } : null, now);
  const [starting, setStarting] = useState(false);
  const href = `/app/${slug}/incidents/${incident.number}/postmortem`;

  const due = status.dueAt;
  const lines: { text: string; alert?: boolean }[] = [];
  if (status.state === "REQUIRED" && due) lines.push({ text: p.banner.required(daysUntil(due, now)) });
  if (status.state === "DUE_SOON" && due) lines.push({ text: p.banner.dueSoon(daysUntil(due, now)) });
  if (status.state === "OVERDUE" && due) lines.push({ text: p.banner.overdue(daysOverdue(due, now)), alert: true });
  if (status.state === "DRAFT") {
    lines.push({ text: p.banner.draft });
    if (status.overdue && due) lines.push({ text: p.banner.overdue(daysOverdue(due, now)), alert: true });
    else if (status.dueSoon && due) lines.push({ text: p.banner.dueSoon(daysUntil(due, now)) });
  }
  const urgent = status.state === "OVERDUE" || (status.state === "DRAFT" && status.overdue);

  return (
    <section
      aria-label={p.singular}
      data-postmortem-state={status.state}
      className={`flex flex-wrap items-center justify-between gap-3 rounded border p-4 ${urgent ? "border-danger" : "border-border"}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{p.singular}</h2>
          <PostmortemBadge state={status.state} label={p.states[status.state]} />
        </div>
        {lines.map((line) => (
          <p
            key={line.text}
            role={line.alert ? "alert" : undefined}
            className={`text-sm ${line.alert ? "text-danger" : ""}`}
          >
            {line.text}
          </p>
        ))}
        {!postmortemStatus && incident.status !== "RESOLVED" && (
          <p className="text-sm text-muted">{p.banner.openHint}</p>
        )}
      </div>
      <div className="flex gap-2">
        {postmortemStatus === "PUBLISHED" ? (
          <Link href={href} className={secondaryButton}>
            {p.banner.view}
          </Link>
        ) : postmortemStatus === "DRAFT" ? (
          <Link href={href} className={secondaryButton}>
            {p.banner.continue}
          </Link>
        ) : (
          <button type="button" className={primaryButton} onClick={() => setStarting(true)}>
            {p.start}
          </button>
        )}
      </div>
      {starting && (
        <StartDialog
          slug={slug}
          number={incident.number}
          severity={incident.severity}
          open={incident.status !== "RESOLVED"}
          templates={templates}
          onClose={() => setStarting(false)}
        />
      )}
    </section>
  );
}

/** Pick a template (the one that suits the severity is preselected) and start. */
function StartDialog({
  slug,
  number,
  severity,
  open: stillOpen,
  templates,
  onClose,
}: {
  slug: string;
  number: number;
  severity: number;
  /** The incident isn't resolved yet. */
  open: boolean;
  templates: TemplateView[];
  onClose: () => void;
}) {
  const t = useCopy();
  const p = t.postmortem;
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const suggested = defaultTemplateIdFor(severity);
  const [templateId, setTemplateId] = useState(
    templates.some((x) => x.id === suggested) ? suggested : (templates[0]?.id ?? ""),
  );
  const [pending, setPending] = useState(false);
  const target = `/app/${slug}/incidents/${number}/postmortem`;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function start() {
    setPending(true);
    const result = await api(`/api/w/${slug}/incidents/${number}/postmortem`, { method: "POST", body: { templateId } });
    if (result.ok) {
      toast.success(p.toasts.started);
      router.push(target);
      return;
    }
    if (result.code === "postmortem_exists") {
      toast.error(p.toasts.alreadyExists);
      router.push(target);
      return;
    }
    setPending(false);
    toast.error(t.errors.generic);
  }

  const nameOf = (tpl: TemplateView) =>
    tpl.builtIn && (tpl.id === "tpl_standard" || tpl.id === "tpl_quick")
      ? p.templates[tpl.id]
      : { name: tpl.name, description: "" };

  return (
    <dialog
      ref={ref}
      aria-labelledby="start-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
      className="m-auto w-[min(92vw,30rem)] rounded-pop border shadow-pop border-border bg-surface p-5 text-fg backdrop:bg-ground/70"
    >
      <h2 id="start-title" className="text-lg font-semibold">
        {p.chooseTemplate}
      </h2>
      {stillOpen && (
        <p role="note" className="mt-2 rounded border border-warning p-2 text-sm text-warning">
          {p.startOpenWarning}
        </p>
      )}
      <fieldset className="mt-3 space-y-2">
        <legend className="sr-only">{p.chooseTemplate}</legend>
        {templates.map((tpl) => {
          const copy = nameOf(tpl);
          return (
            <label
              key={tpl.id}
              className="flex cursor-pointer items-start gap-3 rounded border border-border p-3 has-[:checked]:border-accent"
            >
              <input
                type="radio"
                name="template"
                value={tpl.id}
                checked={templateId === tpl.id}
                onChange={() => setTemplateId(tpl.id)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">
                  {copy.name}
                  {tpl.id === suggested && <span className="ml-2 text-xs text-muted">{p.templateHelp(copy.name)}</span>}
                </span>
                {copy.description && <span className="block text-sm text-muted">{copy.description}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onClose} disabled={pending}>
          {p.cancel}
        </button>
        <button type="button" className={primaryButton} onClick={() => void start()} disabled={pending || !templateId}>
          {pending ? p.starting : p.start}
        </button>
      </div>
    </dialog>
  );
}
