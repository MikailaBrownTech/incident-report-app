/**
 * Where an action item stands relative to its due date. Pure and shared by the board, the lists, the postmortem editor,
 * the incident card and the sidebar badge, so they can never disagree.
 *
 * Dates only, never times. A due date is a calendar day (`YYYY-MM-DD`). The server compares against the UTC date; the
 * browser should pass the viewer's LOCAL date (`localToday()`). Around midnight the two can differ by a day, so a
 * viewer in UTC-8 may see an item as "due today" for a few hours after the server already counts it overdue. The server's
 * date decides filters and counts (overdue only, the sidebar badge); the UI's date decides the wording of each card.
 */

export type ActionItemState = "NO_DATE" | "OVERDUE" | "DUE_SOON" | "ON_TRACK" | "DONE" | "WONT_DO";

/** Due today through this many days ahead counts as "due soon". */
export const DUE_SOON_DAYS = 3;

export interface StateResult {
  state: ActionItemState;
  /** Overdue only: whole days past the due date (at least 1). */
  daysLate: number;
  /** Open items with a date: whole days until it is due (0 = today, negative = overdue). */
  daysUntil: number | null;
}

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` for a Date, using its UTC calendar day (a date column comes back as UTC midnight). */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** `YYYY-MM-DD` for a Date using the viewer's local calendar day. */
export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A real calendar day (rejects 2026-02-30, which `Date` would roll over). */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_PATTERN.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && utcDay(d) === v;
}

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00.000Z`) / DAY_MS);
const asDay = (v: string | Date) => (typeof v === "string" ? v.slice(0, 10) : utcDay(v));

/** `day` plus `n` calendar days. */
export const addDays = (day: string, n: number) => utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS));

export function getActionItemState(
  item: { status: string; dueDate: string | Date | null },
  today: string | Date,
): StateResult {
  if (item.status === "DONE") return { state: "DONE", daysLate: 0, daysUntil: null };
  if (item.status === "WONT_DO") return { state: "WONT_DO", daysLate: 0, daysUntil: null };
  if (item.dueDate === null) return { state: "NO_DATE", daysLate: 0, daysUntil: null };

  const until = dayNumber(asDay(item.dueDate)) - dayNumber(asDay(today));
  if (until < 0) return { state: "OVERDUE", daysLate: -until, daysUntil: until };
  if (until <= DUE_SOON_DAYS) return { state: "DUE_SOON", daysLate: 0, daysUntil: until };
  return { state: "ON_TRACK", daysLate: 0, daysUntil: until };
}

export const isOpenStatus = (status: string) => status === "OPEN" || status === "IN_PROGRESS";
