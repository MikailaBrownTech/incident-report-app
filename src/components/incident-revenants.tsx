"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SeverityBadge, StatusPill } from "@/components/badges";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { inputClass, secondaryButton } from "@/components/form";
import { RevenantCandidateRow } from "@/components/revenant-candidate";
import { RelativeTime } from "@/components/time-display";
import { useToast } from "@/components/toast";
import { severityName, type SeverityLevel, type SeverityOverrides } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { Accountability, Chain, RevenantCandidate } from "@/features/revenants/types";
import { api } from "@/lib/api-client";

export interface RevenantsData {
  chain: Chain | null;
  candidates: RevenantCandidate[];
  accountability: Accountability | null;
}

interface Props {
  slug: string;
  incident: { id: string; number: number };
  data: RevenantsData;
  severityLabels: SeverityOverrides;
}

/** The right-column cards: suggestions while the incident is unlinked, the chain once it is part of one. */
export function IncidentRevenants({ slug, incident, data, severityLabels }: Props) {
  if (data.chain) {
    return (
      <RecurrenceCard
        slug={slug}
        incident={incident}
        chain={data.chain}
        accountability={data.accountability}
        severityLabels={severityLabels}
      />
    );
  }
  if (data.candidates.length > 0) {
    return (
      <PossibleRevenantsCard
        slug={slug}
        incident={incident}
        candidates={data.candidates}
        severityLabels={severityLabels}
      />
    );
  }
  return null;
}

function PossibleRevenantsCard({
  slug,
  incident,
  candidates: initial,
  severityLabels,
}: {
  slug: string;
  incident: { number: number };
  candidates: RevenantCandidate[];
  severityLabels: SeverityOverrides;
}) {
  const t = useCopy();
  const r = t.revenant;
  const toast = useToast();
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const shown = initial.filter((c) => !hidden.has(c.incident.number)).slice(0, 3);
  if (shown.length === 0) return null;

  async function link(c: RevenantCandidate) {
    setBusy(true);
    const result = await api(`/api/w/${slug}/incidents/${incident.number}/revenant-link`, {
      method: "POST",
      body: { revenantOfNumber: c.incident.number },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.fieldErrors?.revenantOfNumber ? r.toasts.notEarlier : r.toasts.linkFailed);
      return;
    }
    toast.success(r.toasts.linked);
    router.refresh();
  }

  async function dismiss(c: RevenantCandidate) {
    setHidden((h) => new Set(h).add(c.incident.number));
    const result = await api(`/api/w/${slug}/incidents/${incident.number}/revenant-dismiss`, {
      method: "POST",
      body: { candidateNumber: c.incident.number },
    });
    if (!result.ok) {
      setHidden((h) => {
        const next = new Set(h);
        next.delete(c.incident.number);
        return next;
      });
      toast.error(r.toasts.linkFailed);
      return;
    }
    toast.success(r.toasts.dismissed);
  }

  return (
    <section
      aria-labelledby="possible-revenants-heading"
      data-testid="possible-revenants"
      className="space-y-3 rounded border border-border bg-surface p-4"
    >
      <h2 id="possible-revenants-heading" className="text-lg font-semibold">
        {r.possibleTitle}
      </h2>
      <p className="text-xs text-muted">{r.suggestionIntro}</p>
      <ul className="space-y-2">
        {shown.map((c) => (
          <RevenantCandidateRow
            key={c.incident.id}
            slug={slug}
            candidate={c}
            severityLabels={severityLabels}
            linkDisabled={busy}
            onLink={() => void link(c)}
            onDismiss={() => void dismiss(c)}
          />
        ))}
      </ul>
    </section>
  );
}

function RecurrenceCard({
  slug,
  incident,
  chain,
  accountability,
  severityLabels,
}: {
  slug: string;
  incident: { id: string; number: number };
  chain: Chain;
  accountability: Accountability | null;
  severityLabels: SeverityOverrides;
}) {
  const t = useCopy();
  const r = t.revenant;
  const toast = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const members = chain.members;
  const position = members.findIndex((m) => m.id === incident.id) + 1;
  const isRoot = incident.id === chain.rootId;
  const root = members.find((m) => m.id === chain.rootId) ?? members[0];
  const times = members.map((m) => Date.parse(m.startedAt));
  const span = Math.max(1, times[times.length - 1] - times[0]);

  async function unlink() {
    setPending(true);
    const result = await api(`/api/w/${slug}/incidents/${incident.number}/revenant-link`, { method: "DELETE" });
    setPending(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(r.toasts.linkFailed);
      return;
    }
    toast.success(r.toasts.unlinked);
    router.refresh();
  }

  return (
    <section
      aria-labelledby="recurrence-heading"
      data-testid="recurrence-card"
      className="space-y-3 rounded border border-border bg-surface p-4"
    >
      <h2 id="recurrence-heading" className="text-lg font-semibold">
        {r.cardTitle}
      </h2>
      <p className="font-medium" data-testid="recurrence-headline">
        {isRoot ? r.headlineRoot(members.length - 1) : r.headlineMember(position, members.length)}
      </p>

      <div aria-hidden="true" className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {members.map((m, i) => (
          <span
            key={m.id}
            title={new Date(m.startedAt).toLocaleDateString()}
            style={{ left: `${((times[i] - times[0]) / span) * 100}%` }}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent ${m.id === incident.id ? "size-3.5 bg-accent" : "size-2.5 bg-surface"}`}
          />
        ))}
      </div>

      <ol className="space-y-2">
        {members.map((m) => (
          <li
            key={m.id}
            aria-current={m.id === incident.id ? "true" : undefined}
            data-testid={`chain-${m.number}`}
            className={`space-y-1 rounded border p-2 ${m.id === incident.id ? "border-accent bg-bg" : "border-border"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/app/${slug}/incidents/${m.number}`} className="text-sm text-accent underline">
                {t.incident.number(m.number)}
              </Link>
              <SeverityBadge
                level={m.severity as SeverityLevel}
                label={severityName(t, m.severity as SeverityLevel, severityLabels)}
              />
              <StatusPill label={t.status[m.status as keyof typeof t.status]} resolved={m.status === "RESOLVED"} />
              {m.id === incident.id && <span className="text-xs font-semibold">{r.thisOne}</span>}
            </div>
            <p className="text-sm">{m.title}</p>
            <p className="text-xs text-muted">
              <RelativeTime iso={m.startedAt} />
              {" · "}
              {m.gapDays === null ? r.firstOccurrence : r.gapLater(m.gapDays)}
            </p>
          </li>
        ))}
      </ol>

      {accountability && accountability.earlier.length > 0 && (
        <AccountabilityBlock slug={slug} accountability={accountability} />
      )}

      <div className="flex flex-wrap gap-2">
        {!isRoot && (
          <button type="button" className={secondaryButton} onClick={() => setConfirming(true)}>
            {r.unlink}
          </button>
        )}
        {isRoot && <LinkAnother slug={slug} root={root} memberIds={members.map((m) => m.id)} />}
      </div>

      <ConfirmDialog
        open={confirming}
        title={r.unlinkConfirmTitle}
        body={r.unlinkConfirmBody}
        confirmLabel={r.unlink}
        pending={pending}
        onConfirm={() => void unlink()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

export function AccountabilityBlock({ slug, accountability }: { slug: string; accountability: Accountability }) {
  const t = useCopy();
  const a = t.revenant.accountability;
  return (
    <div data-testid="accountability" className="space-y-2 border-t border-border pt-3">
      <h3 className="text-sm font-semibold">{a.heading}</h3>
      <ul className="space-y-1 text-sm">
        {accountability.earlier.map((e) => {
          const label = t.incident.number(e.incident.number);
          return (
            <li key={e.incident.id}>
              {e.postmortem && e.progress
                ? a.previous(
                    label,
                    e.postmortem.status === "PUBLISHED" ? a.published : a.draft,
                    e.progress.done,
                    e.progress.total,
                    e.progress.overdue,
                  )
                : a.noPostmortem(label)}
            </li>
          );
        })}
      </ul>
      {accountability.openItems.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{a.openHeading}</p>
          <ul className="space-y-1 text-sm">
            {accountability.openItems.map((i) => (
              <li key={i.id} className={i.overdue ? "text-danger" : ""}>
                <Link
                  href={`/app/${slug}/action-items?incident=${i.incidentNumber}&q=${encodeURIComponent(i.title)}`}
                  className="underline"
                >
                  {i.title}
                </Link>
                <span className="text-xs text-muted">{` ${t.incident.number(i.incidentNumber)}`}</span>
                {i.overdue && <span className="ml-1 text-xs font-semibold">{t.ritual.states.OVERDUE}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : accountability.allDone ? (
        <p className="text-sm">{a.allDone}</p>
      ) : (
        <p className="text-sm text-muted">{a.none}</p>
      )}
    </div>
  );
}

/** Attach an occurrence that was missed: search by number or title, then link it to this chain's root. */
function LinkAnother({ slug, root, memberIds }: { slug: string; root: { number: number }; memberIds: string[] }) {
  const t = useCopy();
  const r = t.revenant;
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; number: number; title: string }[] | null>(null);

  async function search(value: string) {
    setQ(value);
    if (value.trim().length < 1) {
      setResults(null);
      return;
    }
    const res = await api<{ items: { id: string; number: number; title: string }[] }>(
      `/api/w/${slug}/incidents?${new URLSearchParams({ q: value.trim(), open: "0", limit: "6" }).toString()}`,
    );
    setResults(res.ok ? res.data.items.filter((i) => !memberIds.includes(i.id)) : []);
  }

  async function attach(number: number) {
    const result = await api(`/api/w/${slug}/incidents/${number}/revenant-link`, {
      method: "POST",
      body: { revenantOfNumber: root.number },
    });
    if (!result.ok) {
      toast.error(result.fieldErrors?.revenantOfNumber ? r.toasts.notEarlier : r.toasts.linkFailed);
      return;
    }
    toast.success(r.toasts.linked);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className={secondaryButton} onClick={() => setOpen(true)}>
        {r.linkAnother}
      </button>
    );
  }
  return (
    <div className="w-full space-y-2">
      <p className="text-xs text-muted">{r.linkAnotherHelp}</p>
      <label htmlFor="link-another-search" className="sr-only">
        {r.searchPlaceholder}
      </label>
      <input
        id="link-another-search"
        type="search"
        value={q}
        placeholder={r.searchPlaceholder}
        onChange={(e) => void search(e.target.value)}
        className={inputClass}
      />
      {results !== null &&
        (results.length === 0 ? (
          <p className="text-sm text-muted">{r.noSearchMatch}</p>
        ) : (
          <ul className="space-y-1">
            {results.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => void attach(i.number)}
                  className="flex w-full items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-sm hover:border-accent"
                >
                  <span>{t.incident.number(i.number)}</span>
                  <span className="truncate">{i.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>
        {t.actions.cancel}
      </button>
    </div>
  );
}
