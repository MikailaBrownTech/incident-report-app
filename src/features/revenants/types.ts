import type { MatchStrength } from "./score";

/** Pure and browser-safe: the chains view imports it, so it must not live next to the server queries. */
export const SORTS = ["recent", "occurrences", "rituals"] as const;

/** What the revenant views show about an incident. Dates are ISO strings. */
export interface IncidentSummary {
  id: string;
  number: number;
  title: string;
  severity: number;
  status: string;
  startedAt: string;
  resolvedAt: string | null;
}

export interface RevenantCandidate {
  incident: IncidentSummary;
  score: number;
  titleScore: number;
  serviceScore: number;
  strength: MatchStrength;
  sharedServices: { id: string; name: string }[];
  /** Structured, so each skin can say it in its own words. */
  reason: { similarTitle: boolean; sharedServices: string[] };
  /** Set when the candidate belongs to a chain: link targets resolve to `root`. */
  chain: { root: { id: string; number: number; title: string }; size: number } | null;
}

export interface ChainMember extends IncidentSummary {
  /** Whole days since the previous occurrence started; null for the first. */
  gapDays: number | null;
}

export interface Chain {
  rootId: string;
  /** Oldest first. At least two (a root and a revenant); a lone incident has no chain. */
  members: ChainMember[];
}

export interface EarlierOccurrence {
  incident: IncidentSummary;
  postmortem: { id: string; status: "DRAFT" | "PUBLISHED" } | null;
  /** Done of total action items (not counting won't do) and overdue ones; null with no postmortem. */
  progress: { done: number; total: number; overdue: number } | null;
}

export interface OpenItem {
  id: string;
  title: string;
  status: "OPEN" | "IN_PROGRESS";
  dueDate: string | null;
  ownerId: string;
  incidentNumber: number;
  overdue: boolean;
}

export interface Accountability {
  earlier: EarlierOccurrence[];
  openItems: OpenItem[];
  totals: { items: number; done: number; open: number; overdue: number };
  /** Earlier action items exist and every one is done (or won't do). */
  allDone: boolean;
}

export interface ChainRow {
  rootId: string;
  root: IncidentSummary;
  occurrences: number;
  firstAt: string;
  lastAt: string;
  services: { id: string; name: string }[];
  /** Sum of durations in milliseconds; open incidents count up to now. */
  totalDurationMs: number;
  highestSeverity: number;
  openRituals: number;
  /** The latest occurrence's postmortem state (see getPostmortemStatus). */
  lastPostmortemState: string;
  members: ChainMember[];
}

export interface Suspect {
  /** The later, unlinked incident. */
  incident: IncidentSummary;
  /** The earlier one it looks like a recurrence of (its chain's root is where the link would go). */
  target: IncidentSummary;
  root: { id: string; number: number; title: string };
  score: number;
  titleScore: number;
  serviceScore: number;
  sharedServices: string[];
}
