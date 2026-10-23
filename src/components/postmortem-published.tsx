"use client";

import { Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { primaryButton, secondaryButton } from "@/components/form";
import { RichTextView } from "@/components/rich-text-view";
import { useToast } from "@/components/toast";
import { type SeverityOverrides, severityName, type SeverityLevel } from "@/copy";
import type { PostmortemSectionKey } from "@/copy/types";
import { useCopy } from "@/copy/provider";
import { isMeaningful, docText } from "@/features/postmortems/content";
import { postmortemToMarkdown } from "@/features/postmortems/markdown";
import type { ActionItemView } from "@/features/action-items/schema";
import type { PostmortemPayload } from "@/features/postmortems/schema";
import { api } from "@/lib/api-client";
import { formatExact } from "@/lib/time";

interface Props {
  slug: string;
  incident: { number: number; title: string; severity: number; status: string };
  severityLabels: SeverityOverrides;
  payload: PostmortemPayload;
  canUnpublish: boolean;
  onUnpublished: (payload: PostmortemPayload) => void;
  /** The postmortem's action items (live), for the markdown checklist. */
  actionItems?: ActionItemView[];
  /** The live action items panel, shown in place of the old placeholder. */
  actionPanel?: ReactNode;
}

/** The finished postmortem: read-only, clean to print, copyable as markdown. */
export function PostmortemPublished({
  slug,
  incident,
  severityLabels,
  payload,
  canUnpublish,
  onUnpublished,
  actionItems = [],
  actionPanel,
}: Props) {
  const t = useCopy();
  const p = t.postmortem;
  const toast = useToast();
  const { postmortem, template, people } = payload;
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const defs = [...template.sections].sort((a, b) => a.order - b.order);
  const titleOf = (key: string) => p.sections[key as PostmortemSectionKey]?.title ?? key;
  const nameOf = (id: string | null) =>
    id ? people[id]?.name || people[id]?.email || t.timeline.actorFormerMember : "";
  const shown = defs.filter(
    (d) => docText(postmortem.sections[d.key]).trim().length > 0 || isMeaningful(postmortem.sections[d.key]),
  );

  async function copyMarkdown() {
    const text = postmortemToMarkdown({
      heading: `${t.incident.number(incident.number)}: ${incident.title}`,
      meta: [
        `${severityName(t, incident.severity as SeverityLevel, severityLabels)}`,
        p.publishedBy(
          nameOf(postmortem.publishedById),
          postmortem.publishedAt ? formatExact(new Date(postmortem.publishedAt)) : "",
        ),
      ],
      sections: defs.map((d) => ({ key: d.key, title: titleOf(d.key) })),
      content: postmortem.sections,
      actionItems: {
        heading: t.ritual.card.heading,
        items: actionItems.map((i) => ({
          title: i.title,
          done: i.status === "DONE",
          wontDo: i.status === "WONT_DO" ? (i.wontDoReason ?? "") : undefined,
          owner: nameOf(i.ownerId) || undefined,
          due: i.dueDate,
        })),
      },
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success(p.copied);
    } catch {
      toast.error(p.copyFailed);
    }
  }

  async function unpublish() {
    setPending(true);
    const result = await api<PostmortemPayload>(`/api/w/${slug}/incidents/${incident.number}/postmortem/unpublish`, {
      method: "POST",
    });
    setPending(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(t.errors.generic);
      return;
    }
    toast.success(p.toasts.unpublished);
    onUnpublished(result.data);
  }

  return (
    <article className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted">{p.readOnlyNotice}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} onClick={() => void copyMarkdown()}>
            {p.copyMarkdown}
          </button>
          <button
            type="button"
            className={`${secondaryButton} inline-flex items-center gap-1.5`}
            onClick={() => window.print()}
          >
            <Printer aria-hidden="true" className="size-4" />
            {p.print}
          </button>
          {canUnpublish && (
            <button type="button" className={secondaryButton} onClick={() => setConfirming(true)}>
              {p.unpublish}
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted">
        {p.publishedBy(
          nameOf(postmortem.publishedById),
          postmortem.publishedAt ? formatExact(new Date(postmortem.publishedAt)) : "",
        )}
      </p>

      <div className="max-w-3xl space-y-8">
        {shown.map((d) => (
          <section key={d.key} aria-labelledby={`heading-${d.key}`} className="space-y-2 break-inside-avoid-page">
            <h2 id={`heading-${d.key}`} className="text-lg font-semibold">
              {titleOf(d.key)}
            </h2>
            <RichTextView doc={postmortem.sections[d.key]} />
          </section>
        ))}

        {actionPanel}
      </div>

      <ConfirmDialog
        open={confirming}
        title={p.unpublishConfirmTitle}
        body={p.unpublishConfirmBody}
        confirmLabel={p.unpublish}
        pending={pending}
        onConfirm={() => void unpublish()}
        onCancel={() => setConfirming(false)}
      />
    </article>
  );
}
