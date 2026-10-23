"use client";

import Link from "next/link";
import { useState } from "react";
import { SeverityBadge, StatusPill } from "@/components/badges";
import { PostmortemBadge } from "@/components/postmortem-badge";
import { PostmortemEditor } from "@/components/postmortem-editor";
import { PostmortemPublished } from "@/components/postmortem-published";
import { type SeverityLevel, type SeverityOverrides, severityName } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { StatusKey } from "@/features/incidents/schema";
import type { PostmortemPayload } from "@/features/postmortems/schema";

interface Props {
  slug: string;
  incident: { number: number; title: string; severity: number; status: StatusKey };
  severityLabels: SeverityOverrides;
  initial: PostmortemPayload;
  canUnpublish: boolean;
  autosaveMs?: number;
}

/** The incident header card, then the editor (draft) or the read-only document (published). */
export function PostmortemPage({ slug, incident, severityLabels, initial, canUnpublish, autosaveMs }: Props) {
  const t = useCopy();
  const [payload, setPayload] = useState(initial);
  // a new editor each time the postmortem comes back from being published
  const [generation, setGeneration] = useState(0);
  const published = payload.postmortem.status === "PUBLISHED";

  return (
    <div className="space-y-5">
      <header className="space-y-3 rounded border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-mono">{t.incident.number(incident.number)}</span>
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
        />
      )}
    </div>
  );
}
