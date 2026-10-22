import { z } from "zod";
import type { IncidentStatus } from "@/generated/prisma/client";

export const STATUSES: IncidentStatus[] = ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"];
export const SEVERITIES = [1, 2, 3, 4, 5] as const;
export const SORT_KEYS = ["started", "severity", "status", "number"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export const PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

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
  /** Rows per page. */
  limit: number;
  /** Id of the last row of the previous page. */
  cursor: string | null;
}

type Raw = Record<string, string | string[] | undefined>;

/** Accepts `a,b` and repeated `?k=a&k=b`; trims and drops empties. */
function many(value: unknown): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      list
        .flatMap((v) => String(v).split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
/** "" counts as "not provided" (an emptied date input). */
const firstOrUndefined = (value: unknown) => {
  const v = first(value);
  return typeof v === "string" && v.trim() === "" ? undefined : v;
};
/** A real calendar day. Round-trips through Date so "2026-02-30" (which V8 rolls over) is rejected. */
export const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** Collapse a URLSearchParams into the shape the parsers expect (repeated keys become arrays). */
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

/**
 * The page's parser: turns URL search params into list params and quietly ignores anything invalid, so a
 * hand-edited or stale URL still renders a list.
 */
export function parseListParams(raw: Raw): ListParams {
  const sort = SORT_KEYS.find((k) => k === first(raw.sort)) ?? "started";
  const dirRaw = first(raw.dir);
  const from = first(raw.from);
  const to = first(raw.to);
  const limit = Number(first(raw.limit));
  return {
    q: String(first(raw.q) ?? "")
      .trim()
      .slice(0, 100),
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
    limit: Number.isInteger(limit) && limit >= 1 ? Math.min(limit, MAX_PAGE_SIZE) : PAGE_SIZE,
    cursor: String(first(raw.cursor) ?? "").trim() || null,
  };
}

const list = <T extends z.ZodType>(item: T, max = 25) => z.preprocess(many, z.array(item).max(max));

/** The API's schema: same inputs as the page, but invalid values are an error instead of being ignored. */
export const listQuerySchema = z.object({
  q: z.preprocess(firstOrUndefined, z.string().trim().max(100, "too_long").default("")),
  status: list(z.enum(["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"], { error: "invalid_status" })),
  severity: list(
    z.coerce
      .number({ error: "invalid_severity" })
      .int("invalid_severity")
      .min(1, "invalid_severity")
      .max(5, "invalid_severity"),
  ),
  service: list(z.string().min(1)),
  from: z.preprocess(firstOrUndefined, z.string().refine(isDay, "invalid_date").optional()),
  to: z.preprocess(firstOrUndefined, z.string().refine(isDay, "invalid_date").optional()),
  open: z.preprocess(firstOrUndefined, z.enum(["0", "1"], { error: "invalid_open" }).optional()),
  sort: z.preprocess(firstOrUndefined, z.enum(SORT_KEYS, { error: "invalid_sort" }).default("started")),
  dir: z.preprocess(firstOrUndefined, z.enum(["asc", "desc"], { error: "invalid_dir" }).optional()),
  limit: z.preprocess(
    firstOrUndefined,
    z.coerce
      .number({ error: "invalid_limit" })
      .int("invalid_limit")
      .min(1, "invalid_limit")
      .max(MAX_PAGE_SIZE, "invalid_limit")
      .default(PAGE_SIZE),
  ),
  cursor: z.preprocess(firstOrUndefined, z.string().min(1).max(100).optional()),
});

export type ListQueryResult = { ok: true; params: ListParams } | { ok: false; fieldErrors: Record<string, string[]> };

/** Strictly validate an API query string. */
export function parseListQuery(raw: Raw): ListQueryResult {
  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  const q = parsed.data;
  return {
    ok: true,
    params: {
      q: q.q,
      status: q.status,
      severity: q.severity,
      serviceIds: q.service,
      from: q.from ?? null,
      to: q.to ?? null,
      openOnly: q.open !== "0",
      sort: q.sort,
      dir: q.dir ?? defaultDir(q.sort),
      limit: q.limit,
      cursor: q.cursor ?? null,
    },
  };
}

/** Number typed into the search box: "42", "#42", "INC-42" or "Haunting #42". Null if it isn't one. */
export function numberFromQuery(q: string): number | null {
  const m = /^(?:inc-?|#|haunting\s*#?)?\s*(\d{1,9})$/i.exec(q.trim());
  return m ? Number(m[1]) : null;
}
