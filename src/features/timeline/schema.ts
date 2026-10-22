import { z } from "zod";
import type { PersonView } from "@/features/incidents/schema";

/** Pure (no server imports): shared by the API routes and the client components. */

export const NOTE_MAX = 5000;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
/** How far ahead of "now" a note's time may be (clock skew between browser and server). */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;
/** `occurredAt` more than this far from `createdAt` marks an entry as backfilled. */
export const BACKFILL_THRESHOLD_MS = 2 * 60 * 1000;

export const FILTERS = ["all", "notes", "status", "roles", "key"] as const;
export type TimelineFilter = (typeof FILTERS)[number];
export const ORDERS = ["asc", "desc"] as const;
export type TimelineOrder = (typeof ORDERS)[number];

/** Which event types each type-based filter shows. "all" and "key" are not type-based. */
export const FILTER_TYPES = {
  notes: ["NOTE"],
  status: ["STATUS_CHANGED", "SEVERITY_CHANGED"],
  roles: ["ROLE_ASSIGNED", "ROLE_UNASSIGNED", "SERVICES_CHANGED"],
} as const;

/** The same rule the server's type filter applies, for the client to test entries it receives while refreshing. */
export function matchesFilter(e: { type: string; isKeyMoment: boolean }, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "key") return e.isKeyMoment;
  return (FILTER_TYPES[filter] as readonly string[]).includes(e.type);
}

export type EventSourceKey = "USER" | "SYSTEM" | "INTEGRATION" | "SLACK";

export interface TimelineEventView {
  id: string;
  type: string;
  source: EventSourceKey;
  actorId: string | null;
  body: string | null;
  payload: unknown;
  occurredAt: string;
  createdAt: string;
  editedAt: string | null;
  isKeyMoment: boolean;
}

export interface TimelinePage {
  items: TimelineEventView[];
  /** Continue past the last item of this response, in the order that was asked for. Null at the end. */
  nextCursor: string | null;
  /** Everyone referenced by these items (actors and role holders), including former members. */
  people: Record<string, PersonView>;
  /** Server time of this response; the next refresh asks for changes after it. */
  asOf: string;
}

export interface TimelineChanges {
  /** Entries created or edited since `after`, oldest recorded first. */
  items: TimelineEventView[];
  /** Notes deleted since `after`. */
  deleted: string[];
  people: Record<string, PersonView>;
  asOf: string;
  /** More changed than one response holds: reload instead of merging. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------------------------- rules

/** Only a person's own note can be edited or deleted; every automatic event is immutable. */
export const isManualNote = (e: { type: string; source: string }) => e.type === "NOTE" && e.source === "USER";

/** The author, or an admin/owner, may change a note. */
export const canModifyNote = (
  e: { type: string; source: string; actorId: string | null },
  userId: string,
  isAdmin: boolean,
) => isManualNote(e) && (isAdmin || e.actorId === userId);

export const isBackfilled = (e: { createdAt: string; occurredAt: string }) =>
  Math.abs(new Date(e.createdAt).getTime() - new Date(e.occurredAt).getTime()) > BACKFILL_THRESHOLD_MS;

// ---------------------------------------------------------------------------------------------- cursors

/** Opaque position in the (occurredAt, id) ordering. Survives the row being deleted, unlike an id-only cursor. */
export function encodeCursor(occurredAt: Date | string, id: string): string {
  const t = typeof occurredAt === "string" ? occurredAt : occurredAt.toISOString();
  // ASCII only (an ISO date and a cuid), so btoa is safe; works in the browser and in Node.
  return btoa(JSON.stringify({ t, i: id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeCursor(cursor: string): { t: Date; i: string } | null {
  try {
    const padded = cursor
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.i !== "string" || !parsed.i) return null;
    const t = new Date(parsed.t);
    return Number.isNaN(t.getTime()) ? null : { t, i: parsed.i };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------- bodies

export const noteBodySchema = z.string().trim().min(1, "required").max(NOTE_MAX, "too_long");
const occurredAtSchema = z.iso.datetime({ offset: true, error: "invalid_date" });

export const createNoteBody = z.object({
  body: noteBodySchema,
  occurredAt: occurredAtSchema.optional(),
  isKeyMoment: z.boolean().default(false),
});

export const patchNoteBody = z
  .object({
    body: noteBodySchema.optional(),
    occurredAt: occurredAtSchema.optional(),
    isKeyMoment: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing_to_update" });

// ---------------------------------------------------------------------------------------------- query

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const blankToUndefined = (v: unknown) => {
  const x = first(v);
  return typeof x === "string" && x.trim() === "" ? undefined : x;
};

export const timelineQuerySchema = z.object({
  filter: z.preprocess(blankToUndefined, z.enum(FILTERS, { error: "invalid_filter" }).default("all")),
  order: z.preprocess(blankToUndefined, z.enum(ORDERS, { error: "invalid_order" }).default("asc")),
  limit: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: "invalid_limit" })
      .int("invalid_limit")
      .min(1, "invalid_limit")
      .max(MAX_LIMIT, "invalid_limit")
      .default(DEFAULT_LIMIT),
  ),
  cursor: z.preprocess(
    blankToUndefined,
    z
      .string()
      .max(300, "invalid_cursor")
      .refine((c) => decodeCursor(c) !== null, "invalid_cursor")
      .optional(),
  ),
  after: z.preprocess(blankToUndefined, z.iso.datetime({ offset: true, error: "invalid_date" }).optional()),
});
export type TimelineQuery = z.output<typeof timelineQuerySchema>;

/** Page-side parser: a stale or hand-edited URL falls back to the defaults instead of erroring. */
export function parseTimelineView(raw: Record<string, string | string[] | undefined>): {
  filter: TimelineFilter;
  order: TimelineOrder;
} {
  const filter = FILTERS.find((f) => f === first(raw.filter)) ?? "all";
  const order = ORDERS.find((o) => o === first(raw.order)) ?? "asc";
  return { filter, order };
}
