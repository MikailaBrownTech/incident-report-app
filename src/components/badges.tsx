import { AlertTriangle, CircleDot } from "lucide-react";
import type { SeverityLevel } from "@/copy";

const SEVERITY_TONE: Record<SeverityLevel, string> = {
  1: "border-sev-1 text-fg [&>svg]:text-sev-1",
  2: "border-sev-2 text-fg [&>svg]:text-sev-2",
  3: "border-sev-3 text-fg [&>svg]:text-sev-3",
  4: "border-sev-4 text-fg [&>svg]:text-sev-4",
  5: "border-sev-5 border-2 text-fg font-semibold [&>svg]:text-sev-5",
};

/** Level is always spelled out as text (and a dot count), never colour alone: the border and icon carry the colour. */
export function SeverityBadge({ level, label }: { level: SeverityLevel; label: string }) {
  return (
    <span
      data-severity={level}
      className={`inline-flex items-center gap-1.5 rounded-tag border px-2.5 py-0.5 text-xs ${SEVERITY_TONE[level]}`}
    >
      <CircleDot aria-hidden="true" className="size-3" />
      {label}
    </span>
  );
}

export function StatusPill({ label, resolved = false }: { label: string; resolved?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${
        resolved ? "border-success text-success" : "border-accent text-accent"
      }`}
    >
      {label}
    </span>
  );
}

/** Overdue is shown with an icon and text, not only a red colour. */
export function DueLabel({
  label,
  overdue,
  iconLabel,
}: {
  label: string;
  overdue: boolean;
  iconLabel: string;
}) {
  if (!overdue) return <span className="text-sm text-muted">{label}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
      <AlertTriangle aria-label={iconLabel} role="img" className="size-4" />
      {label}
    </span>
  );
}
