import { AlertTriangle, CircleDot } from "lucide-react";
import type { SeverityLevel } from "@/copy";

const SEVERITY_TONE: Record<SeverityLevel, string> = {
  1: "border-border text-muted",
  2: "border-success text-success",
  3: "border-warning text-warning",
  4: "border-danger text-danger",
  5: "border-danger bg-danger text-bg font-semibold",
};

/** Level is always spelled out as text (and a dot count), never colour alone. */
export function SeverityBadge({ level, label }: { level: SeverityLevel; label: string }) {
  return (
    <span
      data-severity={level}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${SEVERITY_TONE[level]}`}
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
