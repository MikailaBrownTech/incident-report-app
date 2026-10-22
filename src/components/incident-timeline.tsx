"use client";

import { ArrowRightLeft, Gauge, Layers, MessageSquare, Pencil, Sparkles, Star, UserCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/form";
import { Markdown } from "@/components/markdown";
import { RelativeTime } from "@/components/time-display";
import { useToast } from "@/components/toast";
import { severityName, type CopyDictionary, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import { humanizeEvent } from "@/features/timeline/humanize";
import {
  FILTERS,
  FUTURE_SKEW_MS,
  NOTE_MAX,
  canModifyNote,
  isBackfilled,
  matchesFilter,
  type TimelineChanges,
  type TimelineEventView,
  type TimelineFilter,
  type TimelineOrder,
  type TimelinePage,
} from "@/features/timeline/schema";
import { api } from "@/lib/api-client";
import { formatDuration, formatExact, toLocalInput } from "@/lib/time";

const PAGE = 50;
const REFRESH_MS = 15_000;
/** Look slightly further back than the last refresh so an entry committed a moment late is never missed. */
const OVERLAP_MS = 5_000;

interface Props {
  slug: string;
  number: number;
  incidentStartedAt: string;
  /** The newest page, newest first (as returned for `order=desc`). */
  initial: TimelinePage;
  initialFilter: TimelineFilter;
  initialOrder: TimelineOrder;
  /** When the window starts somewhere other than the newest entries: where "Load later" continues from. */
  initialLaterCursor?: string | null;
  currentUserId: string;
  isAdmin: boolean;
  severityLabels: SeverityOverrides;
  /** Bump to refresh right away (the incident was just changed elsewhere on the page). */
  refreshSignal?: number;
  /** Test hook: 0 disables polling. */
  refreshMs?: number;
}

const cmp = (a: TimelineEventView, b: TimelineEventView) =>
  a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const byTime = (items: TimelineEventView[]) => [...items].sort(cmp);

function merge(items: TimelineEventView[], incoming: TimelineEventView[]): TimelineEventView[] {
  const map = new Map(items.map((e) => [e.id, e]));
  for (const e of incoming) map.set(e.id, e);
  return byTime([...map.values()]);
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

const ICONS: Record<string, typeof MessageSquare> = {
  NOTE: MessageSquare,
  STATUS_CHANGED: ArrowRightLeft,
  SEVERITY_CHANGED: Gauge,
  ROLE_ASSIGNED: UserCheck,
  ROLE_UNASSIGNED: UserCheck,
  SERVICES_CHANGED: Layers,
  TITLE_CHANGED: Pencil,
  SUMMARY_CHANGED: Pencil,
};

function offsetLabel(occurredAt: string, startedAt: string): { text: string; before: boolean } {
  const ms = new Date(occurredAt).getTime() - new Date(startedAt).getTime();
  return ms >= 0
    ? { text: `+${formatDuration(ms)}`, before: false }
    : { text: `−${formatDuration(-ms)}`, before: true };
}

function dayLabel(iso: string, t: CopyDictionary, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return t.timeline.today;
  if (diffDays === 1) return t.timeline.yesterday;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function IncidentTimeline(props: Props) {
  const { slug, number, incidentStartedAt, currentUserId, isAdmin, severityLabels } = props;
  const t = useCopy();
  const toast = useToast();
  const hydrated = useHydrated();
  const base = `/api/w/${slug}/incidents/${number}/events`;

  const [filter, setFilter] = useState(props.initialFilter);
  const [order, setOrder] = useState(props.initialOrder);
  // Canonical list: oldest first. `order` only changes how it is displayed.
  const [items, setItems] = useState(() => byTime(props.initial.items));
  const [people, setPeople] = useState(props.initial.people);
  const [earlierCursor, setEarlierCursor] = useState<string | null>(props.initial.nextCursor);
  const [laterCursor, setLaterCursor] = useState<string | null>(props.initialLaterCursor ?? null);
  const [view, setView] = useState<"ready" | "loading" | "error">("ready");
  const [more, setMore] = useState<"earlier" | "later" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TimelineEventView | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

  // The latest values for timers and event listeners, which would otherwise see stale state.
  const live = useRef({ filter, items, asOf: props.initial.asOf, earlierCursor });
  useEffect(() => {
    live.current.filter = filter;
    live.current.items = items;
    live.current.earlierCursor = earlierCursor;
  });
  const tempId = useRef(0);

  const mergePeople = useCallback((extra: Record<string, PersonView>) => setPeople((p) => ({ ...p, ...extra })), []);

  // ------------------------------------------------------------------------------------------ loading

  const reload = useCallback(
    async (nextFilter: TimelineFilter) => {
      setView("loading");
      const result = await api<TimelinePage>(`${base}?filter=${nextFilter}&order=desc&limit=${PAGE}`);
      if (!result.ok) {
        setView("error");
        return;
      }
      setItems(byTime(result.data.items));
      setPeople(result.data.people);
      setEarlierCursor(result.data.nextCursor);
      setLaterCursor(null);
      live.current.asOf = result.data.asOf;
      setView("ready");
    },
    [base],
  );

  async function loadEarlier() {
    if (!earlierCursor) return;
    setMore("earlier");
    const result = await api<TimelinePage>(`${base}?filter=${filter}&order=desc&limit=${PAGE}&cursor=${earlierCursor}`);
    setMore(null);
    if (!result.ok) return toast.error(t.timeline.loadFailed);
    setItems((cur) => merge(cur, result.data.items));
    mergePeople(result.data.people);
    setEarlierCursor(result.data.nextCursor);
  }

  async function loadLater() {
    if (!laterCursor) return;
    setMore("later");
    const result = await api<TimelinePage>(`${base}?filter=${filter}&order=asc&limit=${PAGE}&cursor=${laterCursor}`);
    setMore(null);
    if (!result.ok) return toast.error(t.timeline.loadFailed);
    setItems((cur) => merge(cur, result.data.items));
    mergePeople(result.data.people);
    setLaterCursor(result.data.nextCursor);
  }

  // ------------------------------------------------------------------------------------------ live refresh

  const refresh = useCallback(async () => {
    const { filter: activeFilter, asOf } = live.current;
    const after = new Date(new Date(asOf).getTime() - OVERLAP_MS).toISOString();
    const result = await api<TimelineChanges>(`${base}?after=${encodeURIComponent(after)}`);
    if (!result.ok) return; // stay quiet; the next tick tries again
    const changes = result.data;
    live.current.asOf = changes.asOf;
    if (changes.truncated) {
      await reload(activeFilter);
      return;
    }
    mergePeople(changes.people);
    setItems((current) => {
      const oldest = current[0];
      const deletedIds = new Set(changes.deleted);
      let next = current.filter((e) => !deletedIds.has(e.id));
      for (const e of changes.items) {
        const known = next.some((x) => x.id === e.id);
        if (!matchesFilter(e, activeFilter)) {
          next = next.filter((x) => x.id !== e.id); // e.g. just un-starred while viewing key moments
        } else if (known) {
          next = next.map((x) => (x.id === e.id ? e : x));
        } else if (!live.current.earlierCursor || !oldest || cmp(e, oldest) >= 0) {
          // A new entry slots in. One older than everything we've loaded waits for "Load earlier" instead,
          // so the window never shows a silent gap.
          next = [...next, e];
        }
      }
      return byTime(next);
    });
  }, [base, mergePeople, reload]);

  const refreshMs = props.refreshMs ?? REFRESH_MS;
  useEffect(() => {
    if (refreshMs <= 0) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, refreshMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [refresh, refreshMs]);

  // Something on the page just changed (status, role, ...): show the resulting entry without waiting for the timer.
  const signal = props.refreshSignal ?? 0;
  const seenSignal = useRef(signal);
  useEffect(() => {
    if (signal !== seenSignal.current) {
      seenSignal.current = signal;
      void refresh();
    }
  }, [signal, refresh]);

  // ------------------------------------------------------------------------------------------ view state in the URL

  function writeUrl(next: { filter?: TimelineFilter; order?: TimelineOrder }) {
    const url = new URL(window.location.href);
    const f = next.filter ?? filter;
    const o = next.order ?? order;
    if (f === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", f);
    if (o === "asc") url.searchParams.delete("order");
    else url.searchParams.set("order", o);
    window.history.replaceState(window.history.state, "", url);
  }

  function chooseFilter(next: TimelineFilter) {
    if (next === filter) return;
    setFilter(next);
    writeUrl({ filter: next });
    void reload(next);
  }

  function chooseOrder(next: TimelineOrder) {
    setOrder(next);
    writeUrl({ order: next });
  }

  // ------------------------------------------------------------------------------------------ changing notes

  /** Adds a note optimistically. Resolves false (after removing it again) when the server refuses. */
  async function addNote(draft: { body: string; occurredAt: string | null; isKeyMoment: boolean }): Promise<boolean> {
    const occurredAt = draft.occurredAt ?? new Date().toISOString();
    const temp: TimelineEventView = {
      id: `pending-${++tempId.current}`,
      type: "NOTE",
      source: "USER",
      actorId: currentUserId,
      body: draft.body,
      payload: {},
      occurredAt,
      createdAt: new Date().toISOString(),
      editedAt: null,
      isKeyMoment: draft.isKeyMoment,
    };
    setItems((cur) => merge(cur, matchesFilter(temp, filter) ? [temp] : []));

    const result = await api<{ event: TimelineEventView; people: Record<string, PersonView> }>(base, {
      method: "POST",
      body: { body: draft.body, occurredAt: draft.occurredAt ?? undefined, isKeyMoment: draft.isKeyMoment },
    });
    if (!result.ok) {
      setItems((cur) => cur.filter((e) => e.id !== temp.id));
      toast.error(t.timeline.noteFailed);
      return false;
    }
    mergePeople(result.data.people);
    setItems((cur) =>
      merge(
        cur.filter((e) => e.id !== temp.id),
        matchesFilter(result.data.event, filter) ? [result.data.event] : [],
      ),
    );
    toast.success(t.timeline.noteAdded);
    return true;
  }

  /** Optimistic edit; puts the old version back and says so on failure. */
  async function changeNote(
    id: string,
    patch: { body?: string; occurredAt?: string; isKeyMoment?: boolean },
    quiet = false,
  ): Promise<boolean> {
    const before = items.find((e) => e.id === id);
    if (!before) return false;
    const optimistic: TimelineEventView = {
      ...before,
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
      ...(patch.isKeyMoment !== undefined ? { isKeyMoment: patch.isKeyMoment } : {}),
    };
    setItems((cur) => merge(cur, [optimistic]));
    const result = await api<{ event: TimelineEventView }>(`${base}/${id}`, { method: "PATCH", body: patch });
    if (!result.ok) {
      setItems((cur) => merge(cur, [before]));
      toast.error(t.timeline.saveFailed);
      return false;
    }
    setItems((cur) => {
      const next = matchesFilter(result.data.event, filter)
        ? merge(cur, [result.data.event])
        : cur.filter((e) => e.id !== id);
      return next;
    });
    if (!quiet) toast.success(t.timeline.noteSaved);
    return true;
  }

  async function removeNote(note: TimelineEventView) {
    setPendingDelete(true);
    const result = await api(`${base}/${note.id}`, { method: "DELETE" });
    setPendingDelete(false);
    setDeleting(null);
    if (!result.ok) {
      toast.error(t.timeline.saveFailed);
      return;
    }
    setItems((cur) => cur.filter((e) => e.id !== note.id));
    toast.success(t.timeline.noteDeleted);
  }

  // ------------------------------------------------------------------------------------------ rendering

  const nameOf = (id: string | null | undefined) => {
    const p = id ? people[id] : undefined;
    return p ? p.name || p.email : t.timeline.actorFormerMember;
  };
  const displayed = order === "asc" ? items : [...items].reverse();
  const hasEarlier = earlierCursor !== null;
  const hasLater = laterCursor !== null;
  const filterLabels: Record<TimelineFilter, string> = {
    all: t.timeline.filterAll,
    notes: t.timeline.filterNotes,
    status: t.timeline.filterStatus,
    roles: t.timeline.filterRoles,
    key: t.timeline.filterKey,
  };

  // "Earlier" is at the top when oldest-first and at the bottom when newest-first; "later" is the opposite.
  const earlierButton = hasEarlier ? (
    <LoadButton onClick={loadEarlier} busy={more === "earlier"} label={t.timeline.loadEarlier} />
  ) : null;
  const laterButton = hasLater ? (
    <LoadButton onClick={loadLater} busy={more === "later"} label={t.timeline.loadLater} />
  ) : null;

  const groups: { label: string; entries: TimelineEventView[] }[] = [];
  if (hydrated) {
    for (const e of displayed) {
      const label = dayLabel(e.occurredAt, t);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.entries.push(e);
      else groups.push({ label, entries: [e] });
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="timeline-heading" data-testid="timeline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="timeline-heading" className="text-lg font-semibold">
          {t.timeline.title}
        </h2>
        <div className="flex items-center gap-2">
          <label htmlFor="timeline-order" className="text-sm text-muted">
            {t.timeline.orderLabel}
          </label>
          <select
            id="timeline-order"
            value={order}
            onChange={(e) => chooseOrder(e.target.value as TimelineOrder)}
            className="rounded border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <option value="asc">{t.timeline.orderOldest}</option>
            <option value="desc">{t.timeline.orderNewest}</option>
          </select>
        </div>
      </div>

      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">{t.timeline.filtersLabel}</legend>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => chooseFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent"
            }`}
          >
            {filterLabels[f]}
          </button>
        ))}
      </fieldset>

      {view === "error" ? (
        <div role="alert" className="space-y-3 rounded border border-danger p-4">
          <p className="text-danger">{t.timeline.loadFailed}</p>
          <button type="button" className={primaryButton} onClick={() => void reload(filter)}>
            {t.timeline.retry}
          </button>
        </div>
      ) : view === "loading" || !hydrated ? (
        <TimelineSkeleton label={t.a11y.loading} />
      ) : items.length === 0 && !hasEarlier && !hasLater ? (
        <p className="rounded border border-dashed border-border px-4 py-6 text-center text-muted">
          {filter === "all" ? t.timeline.empty : t.timeline.emptyFiltered}
        </p>
      ) : (
        <div className="space-y-4">
          {order === "asc" ? earlierButton : laterButton}
          {groups.map((group) => (
            <div key={group.label} className="space-y-1">
              <h3 className="sticky top-0 z-[1] bg-bg/90 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
                {group.label}
              </h3>
              <ol className="space-y-2">
                {group.entries.map((e) => (
                  <TimelineEntry
                    key={e.id}
                    event={e}
                    people={people}
                    startedAt={incidentStartedAt}
                    nameOf={nameOf}
                    severityLabel={(level) => severityName(t, level as SeverityLevel, severityLabels)}
                    canModify={!e.id.startsWith("pending-") && canModifyNote(e, currentUserId, isAdmin)}
                    editing={editingId === e.id}
                    onStartEdit={() => setEditingId(e.id)}
                    onStopEdit={() => setEditingId(null)}
                    onSave={(patch) => changeNote(e.id, patch)}
                    onToggleKey={() => void changeNote(e.id, { isKeyMoment: !e.isKeyMoment }, true)}
                    onDelete={() => setDeleting(e)}
                    incidentStartedAt={incidentStartedAt}
                  />
                ))}
              </ol>
            </div>
          ))}
          {order === "asc" ? laterButton : earlierButton}
        </div>
      )}

      <Composer incidentStartedAt={incidentStartedAt} onAdd={addNote} />

      <ConfirmDialog
        open={deleting !== null}
        title={t.timeline.deleteConfirmTitle}
        body={t.timeline.deleteConfirmBody}
        confirmLabel={t.timeline.delete}
        pending={pendingDelete}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && removeNote(deleting)}
      />
    </section>
  );
}

function LoadButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  const t = useCopy();
  return (
    <div className="flex justify-center">
      <button type="button" className={secondaryButton} onClick={onClick} disabled={busy}>
        {busy ? t.timeline.loadingMore : label}
      </button>
    </div>
  );
}

function TimelineSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 rounded border border-border bg-surface motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- one entry

interface EntryProps {
  event: TimelineEventView;
  people: Record<string, PersonView>;
  startedAt: string;
  incidentStartedAt: string;
  nameOf: (id: string | null | undefined) => string;
  severityLabel: (level: number) => string;
  canModify: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSave: (patch: { body?: string; occurredAt?: string }) => Promise<boolean>;
  onToggleKey: () => void;
  onDelete: () => void;
}

function TimelineEntry(p: EntryProps) {
  const t = useCopy();
  const { event: e } = p;
  const Icon = e.isKeyMoment ? Star : (ICONS[e.type] ?? Sparkles);
  const offset = offsetLabel(e.occurredAt, p.incidentStartedAt);
  const isNote = e.type === "NOTE" && e.source === "USER";
  const pending = e.id.startsWith("pending-");

  const actor: ReactNode = (() => {
    if (e.source === "SYSTEM" && !e.actorId) return t.timeline.actorSystem;
    if (e.source === "INTEGRATION") return t.timeline.actorWebhook;
    if (e.source === "SLACK") return t.timeline.actorSlack;
    if (!e.actorId) return t.timeline.actorSystem;
    return p.nameOf(e.actorId);
  })();
  const person = e.actorId ? p.people[e.actorId] : undefined;
  const showAvatar = e.actorId && e.source !== "INTEGRATION" && e.source !== "SLACK";

  return (
    <li
      id={`event-${e.id}`}
      data-testid={`entry-${e.id}`}
      data-key-moment={e.isKeyMoment ? "true" : undefined}
      className={`rounded border p-3 ${
        e.isKeyMoment ? "border-warning bg-warning/10" : "border-border bg-surface"
      } ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border ${
            e.isKeyMoment ? "border-warning text-warning" : "border-border text-muted"
          }`}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {showAvatar ? <Avatar name={person?.name || person?.email || "?"} image={person?.image ?? null} /> : null}
            <span className="font-medium">{actor}</span>
            {e.isKeyMoment ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning px-2 text-xs text-warning">
                <Star className="size-3" aria-hidden="true" />
                {t.timeline.keyMoment}
              </span>
            ) : null}
            <span className="text-muted">
              <RelativeTime iso={e.occurredAt} />
            </span>
            <span
              className="font-mono text-xs text-muted"
              aria-label={
                offset.before
                  ? t.timeline.beforeStartOffset(offset.text.slice(1))
                  : t.timeline.afterStart(offset.text.slice(1))
              }
            >
              {offset.text}
            </span>
            {isBackfilled(e) ? (
              <span
                className="rounded border border-border px-1.5 text-xs text-muted"
                title={t.timeline.backfilledTooltip(formatExact(new Date(e.createdAt)))}
              >
                {t.timeline.backfilled}
              </span>
            ) : null}
            {e.editedAt ? (
              <span className="text-xs text-muted" title={formatExact(new Date(e.editedAt))}>
                {t.timeline.edited}
              </span>
            ) : null}
          </div>

          {p.editing ? (
            <EditForm event={e} startedAt={p.startedAt} onSave={p.onSave} onCancel={p.onStopEdit} />
          ) : isNote ? (
            <Markdown source={e.body ?? ""} className="text-sm" />
          ) : (
            <p className="text-sm">{humanizeEvent(e, { t, nameOf: p.nameOf, severityLabel: p.severityLabel })}</p>
          )}

          {p.canModify && !p.editing ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className={secondaryButton} aria-pressed={e.isKeyMoment} onClick={p.onToggleKey}>
                {e.isKeyMoment ? t.timeline.unmarkKeyMoment : t.timeline.markKeyMoment}
              </button>
              <button type="button" className={secondaryButton} onClick={p.onStartEdit}>
                {t.timeline.edit}
              </button>
              <button type="button" className={dangerButton} onClick={p.onDelete}>
                {t.timeline.delete}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function EditForm({
  event,
  startedAt,
  onSave,
  onCancel,
}: {
  event: TimelineEventView;
  startedAt: string;
  onSave: (patch: { body?: string; occurredAt?: string }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useCopy();
  const [body, setBody] = useState(event.body ?? "");
  const [when, setWhen] = useState(() => toLocalInput(new Date(event.occurredAt)));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const initialWhen = useRef(when);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const text = body.trim();
    if (!text) return setError(t.validation.required);
    if (text.length > NOTE_MAX) return setError(t.timeline.tooLong(NOTE_MAX));
    const patch: { body?: string; occurredAt?: string } = {};
    if (text !== event.body) patch.body = text;
    if (when !== initialWhen.current) {
      const date = new Date(when);
      if (Number.isNaN(date.getTime())) return setError(t.validation.required);
      if (date.getTime() > Date.now() + FUTURE_SKEW_MS) return setError(t.timeline.futureTime);
      patch.occurredAt = date.toISOString();
    }
    setError(null);
    if (Object.keys(patch).length === 0) return onCancel();
    setPending(true);
    const ok = await onSave(patch);
    setPending(false);
    if (ok) onCancel();
  }

  const early = when && new Date(when).getTime() < new Date(startedAt).getTime();
  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <label htmlFor={`edit-body-${event.id}`} className="sr-only">
        {t.timeline.composerLabel}
      </label>
      <textarea
        id={`edit-body-${event.id}`}
        rows={3}
        value={body}
        maxLength={NOTE_MAX}
        autoFocus
        onChange={(e) => {
          setBody(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
        }}
        aria-invalid={Boolean(error)}
        className={`${inputClass} font-mono text-sm`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t.timeline.happenedAt}
          <input
            type="datetime-local"
            value={when}
            max={toLocalInput(new Date())}
            onChange={(e) => {
              setWhen(e.target.value);
              setError(null);
            }}
            className="rounded border border-border bg-surface px-2 py-1"
          />
        </label>
      </div>
      {early ? <p className="text-sm text-muted">{t.timeline.beforeStart}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={pending}>
          {t.timeline.save}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel} disabled={pending}>
          {t.actions.cancel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------- composer

/**
 * Sticky at the bottom of the timeline. Its text lives only here, so a live refresh (which only touches the list)
 * can never overwrite what someone is typing.
 */
function Composer({
  incidentStartedAt,
  onAdd,
}: {
  incidentStartedAt: string;
  onAdd: (draft: { body: string; occurredAt: string | null; isKeyMoment: boolean }) => Promise<boolean>;
}) {
  const t = useCopy();
  const [body, setBody] = useState("");
  // null means "now", resolved at submit time rather than when the page opened
  const [when, setWhen] = useState<string | null>(null);
  const [isKey, setIsKey] = useState(false);
  const [pending, setPending] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  // "Now" as of the last tick. Render must stay pure, so the clock lives in state (refreshed every 15s and on submit).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const nowInput = toLocalInput(new Date(nowMs));

  const picked = when !== null ? new Date(when) : null;
  const invalidTime = picked !== null && Number.isNaN(picked.getTime());
  const future = picked !== null && !invalidTime && picked.getTime() > nowMs + FUTURE_SKEW_MS;
  const beforeStart = picked !== null && !invalidTime && picked.getTime() < new Date(incidentStartedAt).getTime();
  const empty = body.trim() === "";

  async function submit() {
    if (pending || empty) return;
    // judge the time against the real clock now, not the last tick
    const freshFuture = picked !== null && !invalidTime && picked.getTime() > Date.now() + FUTURE_SKEW_MS;
    if (freshFuture || future || invalidTime) return setShowErrors(true);
    setNowMs(Date.now());
    const draft = { body: body.trim(), occurredAt: picked ? picked.toISOString() : null, isKeyMoment: isKey };
    const saved = { body, when, isKey };
    // Clear straight away: the entry is already showing in the list. Put it all back if it fails.
    setBody("");
    setWhen(null);
    setIsKey(false);
    setShowErrors(false);
    setPending(true);
    const ok = await onAdd(draft);
    setPending(false);
    if (!ok) {
      setBody(saved.body);
      setWhen(saved.when);
      setIsKey(saved.isKey);
    }
  }

  return (
    <form
      aria-label={t.timeline.composerLabel}
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit();
      }}
      className="sticky bottom-0 z-10 space-y-2 rounded border border-border bg-surface p-3 shadow-lg"
    >
      <label htmlFor="timeline-composer" className="sr-only">
        {t.timeline.composerLabel}
      </label>
      <textarea
        id="timeline-composer"
        rows={3}
        value={body}
        maxLength={NOTE_MAX}
        placeholder={t.timeline.composerPlaceholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        className={`${inputClass} font-mono text-sm`}
      />
      {body.length >= NOTE_MAX - 500 ? (
        <p
          className={`text-right text-xs ${body.length >= NOTE_MAX ? "text-danger" : "text-muted"}`}
          aria-live="polite"
        >
          {t.timeline.counter(body.length, NOTE_MAX)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <label htmlFor="timeline-when" className="mb-1 block text-xs text-muted">
            {t.timeline.happenedAt}
          </label>
          <input
            id="timeline-when"
            type="datetime-local"
            value={when ?? nowInput}
            max={nowInput}
            onChange={(e) => {
              setWhen(e.target.value || null);
              setShowErrors(false);
            }}
            aria-invalid={future || invalidTime}
            aria-describedby="timeline-when-help"
            className="rounded border border-border bg-bg px-2 py-1 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isKey} onChange={(e) => setIsKey(e.target.checked)} />
          {t.timeline.markKeyMoment}
        </label>
        <button type="submit" className={`${primaryButton} ml-auto`} disabled={pending || empty}>
          {pending ? t.timeline.submitting : t.timeline.submit}
        </button>
      </div>

      <p
        id="timeline-when-help"
        role={future && showErrors ? "alert" : undefined}
        className={`text-sm ${future ? "text-danger" : "text-muted"}`}
      >
        {future ? t.timeline.futureTime : beforeStart ? t.timeline.beforeStart : t.timeline.happenedAtHelp}
      </p>
    </form>
  );
}
