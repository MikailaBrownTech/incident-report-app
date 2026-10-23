"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionItemsPanel } from "@/components/action-items-panel";
import { AccountabilityBlock } from "@/components/incident-revenants";
import { SeverityBadge, StatusPill } from "@/components/badges";
import { PostmortemBadge } from "@/components/postmortem-badge";
import { PostmortemEditor } from "@/components/postmortem-editor";
import { PostmortemPublished } from "@/components/postmortem-published";
import { type SeverityLevel, type SeverityOverrides, severityName } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { ActionItemView } from "@/features/action-items/schema";
import type { PersonView, StatusKey } from "@/features/incidents/schema";
import type { PostmortemPayload } from "@/features/postmortems/schema";
import type { Accountability } from "@/features/revenants/types";

interface Props {
  slug: string;
  incident: { number: number; title: string; severity: number; status: StatusKey };
  severityLabels: SeverityOverrides;
  initial: PostmortemPayload;
  canUnpublish: boolean;
  autosaveMs?: number;
  /** The postmortem's action items, the people they mention, and who can be given one. */
  actionItems?: ActionItemView[];
  actionPeople?: Record<string, PersonView>;
  members?: PersonView[];
  currentUserId?: string;
  isAdmin?: boolean;
  /** This incident is a recurrence of an earlier one. */
  isRevenant?: boolean;
  /** What earlier occurrences left behind (their postmortems and action items). */
  earlier?: Accountability | null;
}

/** The incident header card, then the editor (draft) or the read-only document (published). */
export function PostmortemPage({
  slug,
  incident,
  severityLabels,
  initial,
  canUnpublish,
  autosaveMs,
  actionItems = [],
  actionPeople = {},
  members = [],
  currentUserId = "",
  isAdmin = false,
  isRevenant = false,
  earlier = null,
}: Props) {
  const t = useCopy();
  const [payload, setPayload] = useState(initial);
  // a new editor each time the postmortem comes back from being published
  const [generation, setGeneration] = useState(0);
  const [items, setItems] = useState(actionItems);
  const [people, setPeople] = useState(actionPeople);
  const published = payload.postmortem.status === "PUBLISHED";
  const panel = (
    <ActionItemsPanel
      slug={slug}
      incidentNumber={incident.number}
      items={items}
      people={people}
      members={members}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      onItems={setItems}
      onPeople={(p) => setPeople((cur) => ({ ...cur, ...p }))}
    />
  );

  return (
    <div className="space-y-5">
      <header className="space-y-3 rounded border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{t.incident.number(incident.number)}</span>
          <PostmortemBadge
            state={published ? "PUBLISHED" : "DRAFT"}
            label={published ? t.postmortem.published : t.postmortem.draft}
          />
        </div>
        <h1 className="text-2xl font-bold">
          <span className="sr-only">{`${t.postmortem.singular}: `}</span>
          {incident.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge
            level={incident.severity as SeverityLevel}
            label={severityName(t, incident.severity as SeverityLevel, severityLabels)}
          />
          <StatusPill label={t.status[incident.status]} resolved={incident.status === "RESOLVED"} />
          <Link
            href={`/app/${slug}/incidents/${incident.number}`}
            className="text-sm text-accent underline print:hidden"
          >
            {t.postmortem.backToIncident}
          </Link>
        </div>
        <p className="text-xs text-muted print:hidden">{t.postmortem.blamelessNote}</p>
      </header>

      {published ? (
        <PostmortemPublished
          slug={slug}
          incident={incident}
          severityLabels={severityLabels}
          payload={payload}
          actionItems={items}
          actionPanel={panel}
          canUnpublish={canUnpublish}
          onUnpublished={(next) => {
            setPayload(next);
            setGeneration((g) => g + 1);
          }}
        />
      ) : (
        <PostmortemEditor
          key={generation}
          slug={slug}
          incidentNumber={incident.number}
          initial={payload}
          autosaveMs={autosaveMs}
          onPublished={setPayload}
          aside={panel}
          actionItemCount={items.length}
          isRevenant={isRevenant}
          earlierOpenItems={earlier?.openItems.length ?? 0}
          above={
            earlier && earlier.earlier.length > 0 ? (
              <section aria-labelledby="previous-occurrences" className="space-y-1 rounded border border-border p-4">
                <h2 id="previous-occurrences" className="text-lg font-semibold">
                  {t.revenant.editor.heading}
                </h2>
                <AccountabilityBlock slug={slug} accountability={earlier} />
              </section>
            ) : null
          }
        />
      )}
    </div>
  );
}
