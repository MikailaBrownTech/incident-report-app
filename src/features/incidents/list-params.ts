import type { IncidentStatus } from "@/generated/prisma/client";

export const STATUSES: IncidentStatus[] = ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"];
export const SEVERITIES = [1, 2, 3, 4, 5] as const;
export const SORT_KEYS = ["started", "severity", "status", "number"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export const PAGE_SIZE = 50;

export interface ListParams {
  q: string;
  status: IncidentStatus[];
  severity: number[];
  serviceIds: string[];
  /** Inclusive start / end days (UTC) for `startedAt`. */
  from: string | null;
  to: string | null;
  /** Default on. Only applies when no explicit status is chosen. */
  openOnly: boolean;
  sort: SortKey;
  dir: SortDir;
  after: string | null;
}

type Raw = Record<string, string | string[] | undefined>;

/** Accepts `a,b` and repeated `?k=a&k=b`; trims and drops empties. */
function many(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [
    ...new Set(
      list
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
/** A real calendar day. Round-trips through Date so "2026-02-30" (which V8 rolls over) is rejected. */
const isDay = (v: string | undefined): v is string => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** Collapse a URLSearchParams into the shape parseListParams expects (repeated keys become arrays). */
export function rawFromSearchParams(sp: URLSearchParams): Raw {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const values = sp.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  return raw;
}

/** True when anything beyond the defaults (open only, newest first) narrows the list. */
export function hasActiveFilters(p: ListParams): boolean {
  return (
    p.q !== "" ||
    p.status.length > 0 ||
    p.severity.length > 0 ||
    p.serviceIds.length > 0 ||
    p.from !== null ||
    p.to !== null ||
    !p.openOnly
  );
}

/** Natural direction per column: newest/most severe/highest first, lifecycle order for status. */
export const defaultDir = (sort: SortKey): SortDir => (sort === "status" ? "asc" : "desc");

/** Turn URL search params into validated list params; anything invalid is ignored, never an error. */
export function parseListParams(raw: Raw): ListParams {
  const sort = SORT_KEYS.find((k) => k === first(raw.sort)) ?? "started";
  const dirRaw = first(raw.dir);
  const from = first(raw.from);
  const to = first(raw.to);
  return {
    q: (first(raw.q) ?? "").trim().slice(0, 100),
    status: many(raw.status).filter((s): s is IncidentStatus => (STATUSES as string[]).includes(s)),
    severity: many(raw.severity)
      .map(Number)
      .filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 5),
    serviceIds: many(raw.service).slice(0, 25),
    from: isDay(from) ? from : null,
    to: isDay(to) ? to : null,
    openOnly: first(raw.open) !== "0",
    sort,
    dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultDir(sort),
    after: first(raw.after)?.trim() || null,
  };
}

/** Number typed into the search box: "42", "#42", "INC-42" or "Haunting #42". Null if it isn't one. */
export function numberFromQuery(q: string): number | null {
  const m = /^(?:inc-?|#|haunting\s*#?)?\s*(\d{1,9})$/i.exec(q.trim());
  return m ? Number(m[1]) : null;
}
