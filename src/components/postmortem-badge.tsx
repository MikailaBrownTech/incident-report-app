import { AlertTriangle, CheckCircle2, CircleSlash, Clock, FileEdit, FileText, Minus } from "lucide-react";
import type { PostmortemStateKey } from "@/copy/types";

const TONE: Record<PostmortemStateKey, string> = {
  NOT_APPLICABLE: "border-border text-muted",
  SKIPPED: "border-border text-muted",
  OPTIONAL: "border-border text-muted",
  REQUIRED: "border-warning text-warning",
  DUE_SOON: "border-warning text-warning font-medium",
  OVERDUE: "border-danger text-danger font-medium",
  DRAFT: "border-accent text-accent",
  PUBLISHED: "border-success text-success",
};

const ICON = {
  NOT_APPLICABLE: Minus,
  SKIPPED: CircleSlash,
  OPTIONAL: Minus,
  REQUIRED: FileText,
  DUE_SOON: Clock,
  OVERDUE: AlertTriangle,
  DRAFT: FileEdit,
  PUBLISHED: CheckCircle2,
} as const;

/** The state is always an icon plus words, never colour alone. */
export function PostmortemBadge({ state, label }: { state: PostmortemStateKey; label: string }) {
  const Icon = ICON[state];
  return (
    <span
      data-postmortem-state={state}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${TONE[state]}`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </span>
  );
}
