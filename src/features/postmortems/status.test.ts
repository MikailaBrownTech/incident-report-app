import { describe, expect, it } from "vitest";
import { daysOverdue, daysUntil, getPostmortemStatus, matchRule, type RuleLike } from "./status";

const DAY = 86_400_000;
const NOW = new Date("2026-06-20T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const resolved = (severity: number, resolvedDaysAgo: number) => ({
  severity,
  status: "RESOLVED",
  resolvedAt: ago(resolvedDaysAgo),
});

const DEFAULT_RULE: RuleLike = { minSeverity: 4, mode: "REQUIRED", dueInDays: 5 };

type Row = {
  name: string;
  incident: Parameters<typeof getPostmortemStatus>[0];
  rules?: RuleLike[];
  pm?: { status: string } | null;
  now?: Date;
  expect: { state: string; requirement?: string; dueAt?: Date | null; overdue?: boolean; dueSoon?: boolean };
};

const rows: Row[] = [
  // ---- rule matching ----
  {
    name: "no rules at all: optional",
    incident: resolved(5, 1),
    rules: [],
    expect: { state: "OPTIONAL", requirement: "OPTIONAL", dueAt: null },
  },
  {
    name: "severity below the only rule's threshold: optional",
    incident: resolved(3, 1),
    expect: { state: "OPTIONAL", requirement: "OPTIONAL", dueAt: null },
  },
  {
    name: "severity exactly at the threshold: required",
    incident: resolved(4, 1),
    expect: { state: "REQUIRED", requirement: "REQUIRED" },
  },
  {
    name: "severity above the threshold: required",
    incident: resolved(5, 1),
    expect: { state: "REQUIRED", requirement: "REQUIRED" },
  },
  {
    name: "several rules: the highest threshold that still fits wins (4 beats 2)",
    incident: resolved(4, 1),
    rules: [
      { minSeverity: 2, mode: "SKIP", dueInDays: 1 },
      { minSeverity: 4, mode: "REQUIRED", dueInDays: 5 },
    ],
    expect: { state: "REQUIRED", requirement: "REQUIRED" },
  },
  {
    name: "several rules: a lower-severity incident falls to the lower rule (SKIP)",
    incident: resolved(3, 1),
    rules: [
      { minSeverity: 2, mode: "SKIP", dueInDays: 1 },
      { minSeverity: 4, mode: "REQUIRED", dueInDays: 5 },
    ],
    expect: { state: "SKIPPED", requirement: "SKIP", dueAt: null },
  },
  {
    name: "several rules in any order: 5 beats 4 beats 1",
    incident: resolved(5, 1),
    rules: [
      { minSeverity: 5, mode: "REQUIRED", dueInDays: 2 },
      { minSeverity: 1, mode: "OPTIONAL", dueInDays: 30 },
      { minSeverity: 4, mode: "SKIP", dueInDays: 9 },
    ],
    expect: { state: "DUE_SOON", dueAt: new Date(ago(1).getTime() + 2 * DAY) },
  },
  {
    name: "below every rule: optional",
    incident: resolved(1, 1),
    rules: [{ minSeverity: 2, mode: "REQUIRED", dueInDays: 5 }],
    expect: { state: "OPTIONAL" },
  },
  {
    name: "legacy modes (OFF, RECOMMENDED) count as optional",
    incident: resolved(5, 1),
    rules: [{ minSeverity: 1, mode: "RECOMMENDED", dueInDays: 5 }],
    expect: { state: "OPTIONAL", requirement: "OPTIONAL" },
  },
  // ---- due date math and thresholds ----
  {
    name: "resolved just now: due in exactly dueInDays",
    incident: { severity: 4, status: "RESOLVED", resolvedAt: NOW },
    expect: { state: "REQUIRED", dueAt: new Date(NOW.getTime() + 5 * DAY), overdue: false, dueSoon: false },
  },
  {
    name: "more than 2 days left: REQUIRED",
    incident: resolved(4, 2.9),
    expect: { state: "REQUIRED", dueSoon: false },
  },
  {
    name: "exactly 2 days left: DUE_SOON (inclusive)",
    incident: resolved(4, 3),
    expect: { state: "DUE_SOON", dueSoon: true, overdue: false },
  },
  {
    name: "1 day left: DUE_SOON",
    incident: resolved(4, 4),
    expect: { state: "DUE_SOON" },
  },
  {
    name: "due at this exact instant: still DUE_SOON, not overdue yet",
    incident: resolved(4, 5),
    expect: { state: "DUE_SOON", overdue: false },
  },
  {
    name: "one millisecond past due: OVERDUE",
    incident: { severity: 4, status: "RESOLVED", resolvedAt: new Date(NOW.getTime() - 5 * DAY - 1) },
    expect: { state: "OVERDUE", overdue: true, dueSoon: false },
  },
  {
    name: "long overdue",
    incident: resolved(5, 40),
    expect: { state: "OVERDUE", overdue: true },
  },
  {
    name: "a different dueInDays changes the date",
    incident: resolved(4, 1),
    rules: [{ minSeverity: 4, mode: "REQUIRED", dueInDays: 14 }],
    expect: { state: "REQUIRED", dueAt: new Date(ago(1).getTime() + 14 * DAY) },
  },
  // ---- lifecycle ----
  {
    name: "open incident: not applicable, no due date",
    incident: { severity: 5, status: "INVESTIGATING", resolvedAt: null },
    expect: { state: "NOT_APPLICABLE", requirement: "REQUIRED", dueAt: null },
  },
  {
    name: "resolved status but no resolvedAt (bad data): not applicable, never throws",
    incident: { severity: 5, status: "RESOLVED", resolvedAt: null },
    expect: { state: "NOT_APPLICABLE", dueAt: null },
  },
  {
    name: "reopened after being overdue: not applicable again",
    incident: { severity: 4, status: "MITIGATING", resolvedAt: null },
    expect: { state: "NOT_APPLICABLE", dueAt: null },
  },
  {
    name: "re-resolved: due date follows the NEW resolved time",
    incident: resolved(4, 0.5),
    expect: { state: "REQUIRED", dueAt: new Date(ago(0.5).getTime() + 5 * DAY) },
  },
  // ---- postmortem present ----
  {
    name: "a draft is DRAFT and keeps overdue information",
    incident: resolved(4, 9),
    pm: { status: "DRAFT" },
    expect: { state: "DRAFT", requirement: "REQUIRED", overdue: true, dueSoon: false },
  },
  {
    name: "a draft that is due soon says so",
    incident: resolved(4, 4),
    pm: { status: "DRAFT" },
    expect: { state: "DRAFT", overdue: false, dueSoon: true },
  },
  {
    name: "a draft on an optional incident has no due information",
    incident: resolved(2, 9),
    pm: { status: "DRAFT" },
    expect: { state: "DRAFT", requirement: "OPTIONAL", dueAt: null, overdue: false, dueSoon: false },
  },
  {
    name: "a draft on a still-open incident is DRAFT",
    incident: { severity: 4, status: "INVESTIGATING", resolvedAt: null },
    pm: { status: "DRAFT" },
    expect: { state: "DRAFT", dueAt: null },
  },
  {
    name: "published: PUBLISHED, no longer overdue",
    incident: resolved(4, 30),
    pm: { status: "PUBLISHED" },
    expect: { state: "PUBLISHED", overdue: false, dueSoon: false },
  },
  {
    name: "published stays published when the incident is reopened",
    incident: { severity: 4, status: "IDENTIFIED", resolvedAt: null },
    pm: { status: "PUBLISHED" },
    expect: { state: "PUBLISHED" },
  },
  {
    name: "published under a SKIP rule is still PUBLISHED",
    incident: resolved(2, 3),
    rules: [{ minSeverity: 1, mode: "SKIP", dueInDays: 1 }],
    pm: { status: "PUBLISHED" },
    expect: { state: "PUBLISHED", requirement: "SKIP" },
  },
  {
    name: "SKIP with no postmortem: SKIPPED",
    incident: resolved(5, 30),
    rules: [{ minSeverity: 1, mode: "SKIP", dueInDays: 1 }],
    expect: { state: "SKIPPED", dueAt: null, overdue: false },
  },
  {
    name: "resolvedAt may arrive as an ISO string (it does, from JSON)",
    incident: { severity: 4, status: "RESOLVED", resolvedAt: ago(1).toISOString() },
    expect: { state: "REQUIRED", dueAt: new Date(ago(1).getTime() + 5 * DAY) },
  },
  {
    name: "the clock decides: the same incident a week later is overdue",
    incident: resolved(4, 1),
    now: new Date(NOW.getTime() + 7 * DAY),
    expect: { state: "OVERDUE" },
  },
];

describe("getPostmortemStatus", () => {
  it.each(rows)("$name", (row) => {
    const result = getPostmortemStatus(row.incident, row.rules ?? [DEFAULT_RULE], row.pm ?? null, row.now ?? NOW);
    const { state, requirement, dueAt, overdue, dueSoon } = row.expect;
    expect(result.state).toBe(state);
    if (requirement !== undefined) expect(result.requirement).toBe(requirement);
    if (dueAt !== undefined) expect(result.dueAt).toEqual(dueAt);
    if (overdue !== undefined) expect(result.overdue).toBe(overdue);
    if (dueSoon !== undefined) expect(result.dueSoon).toBe(dueSoon);
  });

  it("only defines dueAt for resolved incidents with a required postmortem", () => {
    const open = getPostmortemStatus(
      { severity: 5, status: "INVESTIGATING", resolvedAt: null },
      [DEFAULT_RULE],
      null,
      NOW,
    );
    expect(open.dueAt).toBeNull();
    const optional = getPostmortemStatus(resolved(2, 1), [DEFAULT_RULE], null, NOW);
    expect(optional.dueAt).toBeNull();
  });
});

describe("matchRule", () => {
  it("returns null when nothing fits", () => {
    expect(matchRule([{ minSeverity: 3, mode: "REQUIRED", dueInDays: 1 }], 2)).toBeNull();
    expect(matchRule([], 5)).toBeNull();
  });
});

describe("day helpers", () => {
  it("count whole days, rounding the way a banner reads", () => {
    const due = new Date(NOW.getTime() + 5 * DAY);
    expect(daysUntil(due, NOW)).toBe(5);
    expect(daysUntil(new Date(NOW.getTime() + 2.2 * DAY), NOW)).toBe(3);
    expect(daysUntil(new Date(NOW.getTime() + 1000), NOW)).toBe(1);
    expect(daysOverdue(new Date(NOW.getTime() - 2 * DAY), NOW)).toBe(2);
    expect(daysOverdue(new Date(NOW.getTime() - 3600_000), NOW)).toBe(1); // never "overdue by 0 days"
  });
});
