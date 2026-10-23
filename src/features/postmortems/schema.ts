import { z } from "zod";
import type { PersonView } from "@/features/incidents/schema";
import type { Doc } from "./content";
import type { TemplateView } from "./sections";
import type { PostmortemState } from "./status";

export type PostmortemStatusKey = "DRAFT" | "PUBLISHED";

export interface PostmortemView {
  id: string;
  incidentNumber: number;
  templateId: string;
  status: PostmortemStatusKey;
  version: number;
  sections: Record<string, Doc>;
  authorId: string;
  publishedAt: string | null;
  publishedById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the editor and the published view load. */
export interface PostmortemPayload {
  postmortem: PostmortemView;
  template: TemplateView;
  people: Record<string, PersonView>;
}

export const createPostmortemBody = z.object({
  templateId: z.string().min(1).max(100).optional(),
});

export const patchPostmortemBody = z.object({
  version: z.number().int("invalid").min(1, "invalid"),
  /** Only the sections being saved; the rest are left as they are. Validated in `validateContent`. */
  sections: z.record(z.string(), z.unknown()),
});

// ---- postmortems list -------------------------------------------------------------------------------------------

export const LIST_SORTS = ["due", "severity", "number", "published"] as const;
export type ListSort = (typeof LIST_SORTS)[number];
export const LIST_STATES = [
  "REQUIRED",
  "DUE_SOON",
  "OVERDUE",
  "DRAFT",
  "PUBLISHED",
] as const satisfies readonly PostmortemState[];
export type ListState = (typeof LIST_STATES)[number];
export const LIST_PAGE_SIZE = 25;
export const LIST_MAX_PAGE_SIZE = 100;

export interface PostmortemListParams {
  q: string;
  state: ListState[];
  severity: number[];
  needsAttention: boolean;
  sort: ListSort;
  dir: "asc" | "desc";
  limit: number;
  cursor: string | null;
}

export interface PostmortemListRow {
  incidentId: string;
  number: number;
  title: string;
  severity: number;
  /** null when no postmortem exists yet (a required one that is missing). */
  postmortemId: string | null;
  state: PostmortemState;
  dueAt: string | null;
  publishedAt: string | null;
  author: PersonView | null;
}

export interface PostmortemListPage {
  items: PostmortemListRow[];
  nextCursor: string | null;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
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
const firstOrUndefined = (value: unknown) => {
  const v = first(value);
  return typeof v === "string" && v.trim() === "" ? undefined : v;
};
const defaultDir = (sort: ListSort): "asc" | "desc" => (sort === "due" || sort === "number" ? "asc" : "desc");

/** Lenient, for the page: a stale URL still renders. */
export function parseListParams(raw: Raw): PostmortemListParams {
  const sort = LIST_SORTS.find((s) => s === first(raw.sort)) ?? "due";
  const dir = first(raw.dir);
  const limit = Number(first(raw.limit));
  return {
    q: String(first(raw.q) ?? "")
      .trim()
      .slice(0, 100),
    state: many(raw.state).filter((s): s is ListState => (LIST_STATES as readonly string[]).includes(s)),
    severity: many(raw.severity)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
    needsAttention: first(raw.attention) === "1",
    sort,
    dir: dir === "asc" || dir === "desc" ? dir : defaultDir(sort),
    limit: Number.isInteger(limit) && limit >= 1 ? Math.min(limit, LIST_MAX_PAGE_SIZE) : LIST_PAGE_SIZE,
    cursor: String(first(raw.cursor) ?? "").trim() || null,
  };
}

const list = <T extends z.ZodType>(item: T, max = 10) => z.preprocess(many, z.array(item).max(max));

/** Strict, for the API. The URL uses `attention=1`; the API accepts the spec's `needsAttention=1` too. */
export const listQuerySchema = z.object({
  q: z.preprocess(firstOrUndefined, z.string().trim().max(100, "too_long").default("")),
  state: list(z.enum(LIST_STATES, { error: "invalid_state" })),
  severity: list(
    z.coerce
      .number({ error: "invalid_severity" })
      .int("invalid_severity")
      .min(1, "invalid_severity")
      .max(5, "invalid_severity"),
    5,
  ),
  needsAttention: z.preprocess(firstOrUndefined, z.enum(["0", "1"], { error: "invalid_flag" }).optional()),
  attention: z.preprocess(firstOrUndefined, z.enum(["0", "1"], { error: "invalid_flag" }).optional()),
  sort: z.preprocess(firstOrUndefined, z.enum(LIST_SORTS, { error: "invalid_sort" }).default("due")),
  dir: z.preprocess(firstOrUndefined, z.enum(["asc", "desc"], { error: "invalid_dir" }).optional()),
  limit: z.preprocess(
    firstOrUndefined,
    z.coerce
      .number({ error: "invalid_limit" })
      .int("invalid_limit")
      .min(1, "invalid_limit")
      .max(LIST_MAX_PAGE_SIZE, "invalid_limit")
      .default(LIST_PAGE_SIZE),
  ),
  cursor: z.preprocess(firstOrUndefined, z.string().min(1).max(200).optional()),
});

export type ListQueryResult =
  { ok: true; params: PostmortemListParams } | { ok: false; fieldErrors: Record<string, string[]> };

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
      state: q.state,
      severity: q.severity,
      needsAttention: (q.needsAttention ?? q.attention) === "1",
      sort: q.sort,
      dir: q.dir ?? defaultDir(q.sort),
      limit: q.limit,
      cursor: q.cursor ?? null,
    },
  };
}

/** True when anything beyond the defaults narrows the list. */
export const isFiltered = (p: PostmortemListParams) =>
  p.q !== "" || p.state.length > 0 || p.severity.length > 0 || p.needsAttention;
