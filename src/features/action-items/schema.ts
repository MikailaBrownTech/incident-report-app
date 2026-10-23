import { z } from "zod";
import type { PersonView } from "@/features/incidents/schema";
import { isDay } from "./state";

export const STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "WONT_DO"] as const;
export type ActionStatus = (typeof STATUSES)[number];

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const REASON_MAX = 500;
export const BOARD_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** Done and Won't do columns show only this many recent days unless asked for everything. */
export const RECENT_DAYS = 14;

export interface ActionItemView {
  id: string;
  title: string;
  description: string;
  status: ActionStatus;
  wontDoReason: string | null;
  /** `YYYY-MM-DD` or null. */
  dueDate: string | null;
  completedAt: string | null;
  ownerId: string;
  createdById: string;
  position: string;
  postmortemId: string;
  incident: { id: string; number: number; title: string; severity: number };
  createdAt: string;
  updatedAt: string;
}

export interface ItemsPayload {
  items: ActionItemView[];
  people: Record<string, PersonView>;
}

export interface BoardColumn {
  status: ActionStatus;
  items: ActionItemView[];
  /** Cards in this column that match the filters (all of them, not just the loaded page). */
  count: number;
  nextCursor: string | null;
}
export interface BoardPayload {
  columns: BoardColumn[];
  people: Record<string, PersonView>;
  /** The server's UTC date, which decided "overdue" and "due this week" for these filters. */
  today: string;
}

export interface Progress {
  done: number;
  /** Everything except "won't do". */
  total: number;
  overdue: number;
}

const day = z.string().refine(isDay, "invalid_date");

export const createItemBody = z.object({
  title: z.string().trim().min(1, "required").max(TITLE_MAX, "too_long"),
  description: z.string().trim().max(DESCRIPTION_MAX, "too_long").default(""),
  ownerId: z.string().min(1).max(100).optional(),
  dueDate: day.nullable().optional(),
});

export const patchItemBody = z
  .object({
    title: z.string().trim().min(1, "required").max(TITLE_MAX, "too_long"),
    description: z.string().trim().max(DESCRIPTION_MAX, "too_long"),
    ownerId: z.string().min(1).max(100),
    dueDate: day.nullable(),
    status: z.enum(STATUSES, { error: "invalid_status" }),
    wontDoReason: z.string().trim().max(REASON_MAX, "too_long"),
    /** Where a dragged card was dropped: after this card and/or before that one. Never raw positions. */
    afterId: z.string().min(1).max(100).nullable(),
    beforeId: z.string().min(1).max(100).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty");

// ---- query ----------------------------------------------------------------------------------------------------------

export const SORTS = ["due", "created", "title"] as const;
export type Sort = (typeof SORTS)[number];

export interface ItemFilters {
  /** "me", "any", or a user id. */
  owner: string;
  status: ActionStatus[];
  overdue: boolean;
  dueThisWeek: boolean;
  /** Incident number. */
  incident: number | null;
  q: string;
  /** Board only: show Done and Won't do from any date, not just the last 14 days. */
  all: boolean;
}

export interface ListParams extends ItemFilters {
  sort: Sort;
  limit: number;
  cursor: string | null;
  /** Board only: page just this column. */
  column: ActionStatus | null;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const blankToUndefined = (v: unknown) => {
  const f = first(v);
  return typeof f === "string" && f.trim() === "" ? undefined : f;
};
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
const flag = z.preprocess(blankToUndefined, z.enum(["0", "1"], { error: "invalid_flag" }).optional());

const shape = {
  owner: z.preprocess(blankToUndefined, z.string().min(1).max(100).default("any")),
  status: z.preprocess(many, z.array(z.enum(STATUSES, { error: "invalid_status" })).max(4)),
  overdue: flag,
  dueThisWeek: flag,
  incident: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: "invalid_incident" })
      .int("invalid_incident")
      .min(1, "invalid_incident")
      .max(2_000_000_000)
      .optional(),
  ),
  q: z.preprocess(blankToUndefined, z.string().trim().max(100, "too_long").default("")),
  all: flag,
  sort: z.preprocess(blankToUndefined, z.enum(SORTS, { error: "invalid_sort" }).default("due")),
  limit: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: "invalid_limit" })
      .int("invalid_limit")
      .min(1, "invalid_limit")
      .max(MAX_PAGE_SIZE, "invalid_limit")
      .default(BOARD_PAGE_SIZE),
  ),
  cursor: z.preprocess(blankToUndefined, z.string().min(1).max(300).optional()),
  column: z.preprocess(blankToUndefined, z.enum(STATUSES, { error: "invalid_status" }).optional()),
};
export const listQuerySchema = z.object(shape);

function toParams(q: z.output<typeof listQuerySchema>): ListParams {
  return {
    owner: q.owner,
    status: q.status,
    overdue: q.overdue === "1",
    dueThisWeek: q.dueThisWeek === "1",
    incident: q.incident ?? null,
    q: q.q,
    all: q.all === "1",
    sort: q.sort,
    limit: q.limit,
    cursor: q.cursor ?? null,
    column: q.column ?? null,
  };
}

export type ListQueryResult = { ok: true; params: ListParams } | { ok: false; fieldErrors: Record<string, string[]> };

/** Strict, for the API: a bad value is an error. */
export function parseListQuery(raw: Raw): ListQueryResult {
  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return { ok: true, params: toParams(parsed.data) };
}

/** Lenient, for pages: a stale URL still renders, ignoring only the parts that are wrong. */
export function parseListParams(raw: Raw): ListParams {
  const clean: Raw = {};
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    if (raw[key] === undefined) continue;
    if (z.object({ [key]: shape[key] }).safeParse({ [key]: raw[key] }).success) clean[key] = raw[key];
  }
  return toParams(listQuerySchema.parse(clean));
}

export const isFiltered = (f: ItemFilters) =>
  f.owner !== "any" || f.status.length > 0 || f.overdue || f.dueThisWeek || f.incident !== null || f.q !== "";
