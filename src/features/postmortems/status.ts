/**
 * Is a postmortem required for this incident, when is it due, and where does it stand? One pure function used by the
 * incident page, the incident list, the postmortems list (and later the dashboard), so they can never disagree.
 */

export type Requirement = "REQUIRED" | "OPTIONAL" | "SKIP";

export type PostmortemState =
  "NOT_APPLICABLE" | "SKIPPED" | "OPTIONAL" | "REQUIRED" | "DUE_SOON" | "OVERDUE" | "DRAFT" | "PUBLISHED";

export const POSTMORTEM_STATES: readonly PostmortemState[] = [
  "NOT_APPLICABLE",
  "SKIPPED",
  "OPTIONAL",
  "REQUIRED",
  "DUE_SOON",
  "OVERDUE",
  "DRAFT",
  "PUBLISHED",
];

/** States that need somebody to act. */
export const NEEDS_ATTENTION: readonly PostmortemState[] = ["REQUIRED", "DUE_SOON", "OVERDUE"];

/** "Due soon" begins this long before the deadline. */
export const DUE_SOON_MS = 2 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RuleLike {
  minSeverity: number;
  /** REQUIRED, OPTIONAL or SKIP; the legacy OFF and RECOMMENDED count as OPTIONAL. */
  mode: string;
  dueInDays: number;
}

export interface IncidentLike {
  severity: number;
  status: string;
  resolvedAt: Date | string | null;
}

export interface PostmortemStatusResult {
  requirement: Requirement;
  /** resolvedAt + the rule's dueInDays; only for resolved incidents whose postmortem is required. */
  dueAt: Date | null;
  state: PostmortemState;
  /** Required, resolved and past due, whether or not a draft exists. Not set once published. */
  overdue: boolean;
  /** Required, resolved and due within two days (but not yet overdue). Not set once published. */
  dueSoon: boolean;
}

/** The rule with the highest minSeverity that is at or below the incident's severity. */
export function matchRule<R extends RuleLike>(rules: readonly R[], severity: number): R | null {
  let best: R | null = null;
  for (const rule of rules) {
    if (rule.minSeverity <= severity && (best === null || rule.minSeverity > best.minSeverity)) best = rule;
  }
  return best;
}

export function requirementOf(rule: RuleLike | null): Requirement {
  if (!rule) return "OPTIONAL";
  if (rule.mode === "REQUIRED") return "REQUIRED";
  if (rule.mode === "SKIP") return "SKIP";
  return "OPTIONAL";
}

/**
 * - A published postmortem stays published, even if the incident is reopened.
 * - A draft is reported as DRAFT (with `overdue`/`dueSoon` alongside when it is required).
 * - Otherwise an unresolved incident is NOT_APPLICABLE, and a resolved one follows its rule.
 * Reopening and resolving again simply recompute `dueAt` from the new `resolvedAt`.
 */
export function getPostmortemStatus(
  incident: IncidentLike,
  rules: readonly RuleLike[],
  postmortem: { status: string } | null,
  now: Date,
): PostmortemStatusResult {
  const rule = matchRule(rules, incident.severity);
  const requirement = requirementOf(rule);
  const resolved = incident.status === "RESOLVED" && incident.resolvedAt !== null;

  let dueAt: Date | null = null;
  if (resolved && rule && requirement === "REQUIRED") {
    dueAt = new Date(new Date(incident.resolvedAt!).getTime() + rule.dueInDays * DAY_MS);
  }
  const published = postmortem?.status === "PUBLISHED";
  const overdue = !published && dueAt !== null && now.getTime() > dueAt.getTime();
  const dueSoon = !published && dueAt !== null && !overdue && dueAt.getTime() - now.getTime() <= DUE_SOON_MS;

  const base = { requirement, dueAt, overdue, dueSoon };
  if (published) return { ...base, state: "PUBLISHED" };
  if (postmortem) return { ...base, state: "DRAFT" };
  if (!resolved) return { ...base, state: "NOT_APPLICABLE" };
  if (requirement === "SKIP") return { ...base, state: "SKIPPED" };
  if (requirement === "OPTIONAL") return { ...base, state: "OPTIONAL" };
  return { ...base, state: overdue ? "OVERDUE" : dueSoon ? "DUE_SOON" : "REQUIRED" };
}

/** Whole days until `dueAt`, rounded up (due in 5 days exactly reads "5"); negative once past due. */
export const daysUntil = (dueAt: Date, now: Date) => Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS);

/** Whole days past `dueAt`, at least 1 once overdue. */
export const daysOverdue = (dueAt: Date, now: Date) =>
  Math.max(1, Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS));
