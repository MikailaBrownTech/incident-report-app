"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { SeverityBadge, StatusPill } from "@/components/badges";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { dangerButton, inputClass, labelClass, primaryButton, secondaryButton } from "@/components/form";
import { IncidentRitualsCard } from "@/components/incident-rituals-card";
import { IncidentTimeline } from "@/components/incident-timeline";
import { PostmortemPanel } from "@/components/postmortem-panel";
import { Markdown } from "@/components/markdown";
import { ServicePicker, type PickerService } from "@/components/service-picker";
import { LiveDuration, RelativeTime } from "@/components/time-display";
import { useToast } from "@/components/toast";
import { severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import {
  ALL_STATUSES,
  ROLE_KEYS,
  summarySchema,
  titleSchema,
  type IncidentDetailView,
  type PersonView,
  type RoleKey,
  type StatusKey,
} from "@/features/incidents/schema";
import type { Progress } from "@/features/action-items/schema";
import type { TemplateView } from "@/features/postmortems/sections";
import type { RuleLike } from "@/features/postmortems/status";
import type { TimelineFilter, TimelineOrder, TimelinePage } from "@/features/timeline/schema";
import { api, type ApiResult } from "@/lib/api-client";

interface Props {
  slug: string;
  initial: IncidentDetailView;
  members: PersonView[];
  services: PickerService[];
  severityLabels: SeverityOverrides;
  canDelete: boolean;
  currentUserId: string;
  timeline: { page: TimelinePage; filter: TimelineFilter; order: TimelineOrder };
  postmortem: { status: "DRAFT" | "PUBLISHED" | null; rules: RuleLike[]; templates: TemplateView[] };
  /** Done of total action items, and how many are overdue. */
  rituals: Progress;
}

type Saved = ApiResult<{ incident: IncidentDetailView }>;

const SEVERITIES: SeverityLevel[] = [1, 2, 3, 4, 5];

export function IncidentDetail({
  slug,
  initial,
  members,
  services,
  severityLabels,
  canDelete,
  currentUserId,
  timeline,
  postmortem,
  rituals,
}: Props) {
  const t = useCopy();
  const toast = useToast();
  const router = useRouter();
  const [incident, setIncident] = useState(initial);
  const inFlight = useRef(0);
  // bumped after every saved change, so the timeline shows the entry it produced straight away
  const [timelineTick, setTimelineTick] = useState(0);
  const base = `/api/w/${slug}/incidents/${incident.number}`;

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * Show the change immediately; if the server refuses, undo just that change (not other edits that
   * are still in flight) and say so. The server's version replaces ours once nothing else is pending.
   */
  async function save(
    optimistic: (i: IncidentDetailView) => IncidentDetailView,
    revert: (i: IncidentDetailView) => IncidentDetailView,
    request: () => Promise<Saved>,
  ): Promise<boolean> {
    inFlight.current += 1;
    setIncident(optimistic);
    const result = await request();
    inFlight.current -= 1;
    if (!result.ok) {
      setIncident(revert);
      toast.error(t.incidentDetail.saveFailed);
      return false;
    }
    if (inFlight.current === 0) setIncident(result.data.incident);
    setTimelineTick((n) => n + 1);
    return true;
  }

  const patch = (body: Record<string, unknown>) => () =>
    api<{ incident: IncidentDetailView }>(base, { method: "PATCH", body });

  function changeStatus(status: StatusKey) {
    const { status: prev, resolvedAt: prevResolved } = incident;
    if (status === prev) return;
    void save(
      (i) => ({
        ...i,
        status,
        resolvedAt: status === "RESOLVED" ? new Date().toISOString() : prev === "RESOLVED" ? null : i.resolvedAt,
      }),
      (i) => ({ ...i, status: prev, resolvedAt: prevResolved }),
      () => api(`${base}/status`, { method: "POST", body: { status } }),
    );
  }

  function changeSeverity(severity: number) {
    const prev = incident.severity;
    if (severity === prev) return;
    void save(
      (i) => ({ ...i, severity }),
      (i) => ({ ...i, severity: prev }),
      patch({ severity }),
    );
  }

  function changeServices(ids: string[]) {
    const prev = incident.services;
    const next = ids.flatMap((id) => services.filter((s) => s.id === id));
    void save(
      (i) => ({ ...i, services: next }),
      (i) => ({ ...i, services: prev }),
      patch({ serviceIds: ids }),
    );
  }

  function changeRole(role: RoleKey, userId: string | null) {
    const prev = incident.roles[role];
    if ((prev?.userId ?? null) === userId) return;
    const person = userId ? (members.find((m) => m.userId === userId) ?? null) : null;
    void save(
      (i) => ({ ...i, roles: { ...i.roles, [role]: person } }),
      (i) => ({ ...i, roles: { ...i.roles, [role]: prev } }),
      () => api(`${base}/roles`, { method: "PUT", body: { [role]: userId } }),
    );
  }

  async function submitTitle(event: FormEvent) {
    event.preventDefault();
    const parsed = titleSchema.safeParse(titleDraft);
    if (!parsed.success) {
      setTitleError(parsed.error.issues[0]?.message === "too_long" ? t.validation.tooLong(140) : t.validation.required);
      return;
    }
    setTitleError(null);
    setEditingTitle(false);
    if (parsed.data !== incident.title) {
      const prev = incident.title;
      void save(
        (i) => ({ ...i, title: parsed.data }),
        (i) => ({ ...i, title: prev }),
        patch({ title: parsed.data }),
      );
    }
  }

  async function submitSummary(event: FormEvent) {
    event.preventDefault();
    const parsed = summarySchema.safeParse(summaryDraft);
    if (!parsed.success) {
      setSummaryError(t.validation.tooLong(20000));
      return;
    }
    setSummaryError(null);
    setEditingSummary(false);
    if (parsed.data !== incident.summary) {
      const prev = incident.summary;
      void save(
        (i) => ({ ...i, summary: parsed.data }),
        (i) => ({ ...i, summary: prev }),
        patch({ summary: parsed.data }),
      );
    }
  }

  async function remove() {
    setDeleting(true);
    const result = await api(base, { method: "DELETE" });
    setDeleting(false);
    setConfirmDelete(false);
    if (!result.ok) {
      toast.error(t.incidentDetail.saveFailed);
      return;
    }
    toast.success(t.incidentDetail.deleted);
    router.push(`/app/${slug}/incidents`);
  }

  const label = t.incident.number(incident.number);
  const level = incident.severity as SeverityLevel;
  const resolved = incident.status === "RESOLVED";
  const roleLabel = (role: RoleKey) => t.incidentRole[role];

  return (
    <article className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        <Link href={`/app/${slug}/incidents`} className="text-sm text-accent underline underline-offset-2">
          {t.incidentDetail.backToList}
        </Link>

        <header className="space-y-3">
          <p className="font-mono text-sm text-muted">{label}</p>
          {editingTitle ? (
            <form onSubmit={submitTitle} noValidate className="space-y-2">
              <label htmlFor="incident-title" className="sr-only">
                {t.incidentDetail.titleLabel}
              </label>
              <input
                id="incident-title"
                value={titleDraft}
                maxLength={160}
                autoFocus
                onChange={(e) => {
                  setTitleDraft(e.target.value);
                  if (titleError) setTitleError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditingTitle(false);
                    setTitleError(null);
                  }
                }}
                aria-invalid={Boolean(titleError)}
                aria-describedby={titleError ? "incident-title-error" : undefined}
                className={`${inputClass} text-2xl font-bold`}
              />
              {titleError ? (
                <p id="incident-title-error" className="text-sm text-danger">
                  {titleError}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button type="submit" className={primaryButton}>
                  {t.incidentDetail.save}
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => {
                    setEditingTitle(false);
                    setTitleError(null);
                  }}
                >
                  {t.actions.cancel}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-start gap-3">
              <h1 className="min-w-0 flex-1 break-words text-2xl font-bold" data-testid="incident-title">
                {incident.title}
              </h1>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setTitleDraft(incident.title);
                  setEditingTitle(true);
                }}
              >
                {t.incidentDetail.editTitle}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge level={level} label={severityName(t, level, severityLabels)} />
            <StatusPill label={t.status[incident.status]} resolved={resolved} />
            {resolved ? (
              <button type="button" className={secondaryButton} onClick={() => changeStatus("INVESTIGATING")}>
                {t.incidentDetail.reopen}
              </button>
            ) : null}
          </div>
        </header>

        <PostmortemPanel
          slug={slug}
          incident={incident}
          postmortemStatus={postmortem.status}
          rules={postmortem.rules}
          templates={postmortem.templates}
        />

        {incident.roles.COMMANDER ? null : (
          <section role="note" className="rounded border border-warning p-4">
            <p className="font-semibold text-warning">{t.incidentDetail.assignCommanderTitle}</p>
            <p className="text-sm text-muted">{t.incidentDetail.assignCommanderBody}</p>
          </section>
        )}

        <section className="space-y-3" aria-labelledby="summary-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="summary-heading" className="text-lg font-semibold">
              {t.incidentDetail.summaryLabel}
            </h2>
            {editingSummary ? null : (
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setSummaryDraft(incident.summary);
                  setEditingSummary(true);
                }}
              >
                {incident.summary ? t.incidentDetail.editSummary : t.incidentDetail.addSummary}
              </button>
            )}
          </div>
          {editingSummary ? (
            <form onSubmit={submitSummary} noValidate className="space-y-2">
              <label htmlFor="incident-summary" className="sr-only">
                {t.incidentDetail.summaryLabel}
              </label>
              <textarea
                id="incident-summary"
                rows={9}
                value={summaryDraft}
                autoFocus
                onChange={(e) => {
                  setSummaryDraft(e.target.value);
                  if (summaryError) setSummaryError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditingSummary(false);
                }}
                aria-describedby="incident-summary-hint"
                aria-invalid={Boolean(summaryError)}
                className={`${inputClass} font-mono text-sm`}
              />
              <p id="incident-summary-hint" className={`text-sm ${summaryError ? "text-danger" : "text-muted"}`}>
                {summaryError ?? t.incidentDetail.markdownHint}
              </p>
              <div className="flex gap-2">
                <button type="submit" className={primaryButton}>
                  {t.incidentDetail.save}
                </button>
                <button type="button" className={secondaryButton} onClick={() => setEditingSummary(false)}>
                  {t.actions.cancel}
                </button>
              </div>
            </form>
          ) : incident.summary ? (
            <Markdown source={incident.summary} />
          ) : (
            <p className="text-muted">{t.incidentDetail.noSummary}</p>
          )}
        </section>

        <IncidentTimeline
          slug={slug}
          number={incident.number}
          incidentStartedAt={incident.startedAt}
          initial={timeline.page}
          initialFilter={timeline.filter}
          initialOrder={timeline.order}
          currentUserId={currentUserId}
          isAdmin={canDelete}
          severityLabels={severityLabels}
          refreshSignal={timelineTick}
        />
      </div>

      <div className="space-y-5 lg:self-start">
        <aside aria-labelledby="properties-heading" className="space-y-5 rounded border border-border bg-surface p-4">
          <h2 id="properties-heading" className="text-lg font-semibold">
            {t.incidentDetail.propertiesHeading}
          </h2>

          <div>
            <label htmlFor="prop-status" className={labelClass}>
              {t.incidentDetail.statusLabel}
            </label>
            <select
              id="prop-status"
              value={incident.status}
              onChange={(e) => changeStatus(e.target.value as StatusKey)}
              className={inputClass}
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="prop-severity" className={labelClass}>
              {t.incidentDetail.severityLabel}
            </label>
            <select
              id="prop-severity"
              value={incident.severity}
              onChange={(e) => changeSeverity(Number(e.target.value))}
              className={inputClass}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s} {severityName(t, s, severityLabels)}
                </option>
              ))}
            </select>
          </div>

          <ServicePicker
            services={services}
            selectedIds={incident.services.map((s) => s.id)}
            newNames={[]}
            canCreate={false}
            onChange={({ selectedIds }) => changeServices(selectedIds)}
          />

          <fieldset className="space-y-3">
            <legend className={labelClass}>{t.incidentDetail.rolesHeading}</legend>
            {ROLE_KEYS.map((role) => (
              <div key={role}>
                <label htmlFor={`role-${role}`} className="mb-1 block text-xs text-muted">
                  {roleLabel(role)}
                </label>
                <select
                  id={`role-${role}`}
                  value={incident.roles[role]?.userId ?? ""}
                  onChange={(e) => changeRole(role, e.target.value || null)}
                  className={inputClass}
                >
                  <option value="">{t.incidentDetail.unassigned}</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name || m.email}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </fieldset>

          <dl className="space-y-3 border-t border-border pt-4 text-sm">
            <div>
              <dt className="text-xs text-muted">{t.incidentDetail.startedLabel}</dt>
              <dd>
                <RelativeTime iso={incident.startedAt} />
              </dd>
            </div>
            {incident.resolvedAt ? (
              <div>
                <dt className="text-xs text-muted">{t.incidentDetail.resolvedLabel}</dt>
                <dd data-testid="resolved-at">
                  <RelativeTime iso={incident.resolvedAt} />
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-muted">{t.incidentDetail.durationLabel}</dt>
              <dd className="font-mono">
                <LiveDuration startedAt={incident.startedAt} resolvedAt={incident.resolvedAt} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t.incidentDetail.createdByLabel}</dt>
              <dd>{incident.createdBy ? incident.createdBy.name || incident.createdBy.email : "—"}</dd>
            </div>
          </dl>

          {canDelete ? (
            <div className="border-t border-border pt-4">
              <button type="button" className={dangerButton} onClick={() => setConfirmDelete(true)}>
                {t.incidentDetail.deleteIncident}
              </button>
            </div>
          ) : null}
        </aside>
        <IncidentRitualsCard
          slug={slug}
          incidentNumber={incident.number}
          hasPostmortem={postmortem.status !== null}
          progress={rituals}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t.incidentDetail.deleteConfirmTitle(label)}
        body={t.incidentDetail.deleteConfirmBody}
        confirmLabel={t.incidentDetail.deleteIncident}
        pending={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </article>
  );
}
