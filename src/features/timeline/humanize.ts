import { z } from "zod";
import type { CopyDictionary } from "@/copy";
import { ALL_STATUSES, type RoleKey, ROLE_KEYS } from "@/features/incidents/schema";

export interface HumanizeContext {
  t: CopyDictionary;
  /** Display name for a user id; should return something readable even for people who have left. */
  nameOf: (userId: string | null | undefined) => string;
  /** Severity name for a level (the workspace's own names win over the skin's). */
  severityLabel: (level: number) => string;
}

export interface HumanizableEvent {
  type: string;
  payload: unknown;
  /** Who did it; only the "postmortem started" sentence names them. */
  actorId?: string | null;
}

const status = z.enum(ALL_STATUSES);
const role = z.enum(ROLE_KEYS);
const level = z.number().int().min(1).max(5);
const text = z.string();

const statusPayload = z.object({ from: status.optional(), to: status, created: z.boolean().optional() });
const severityPayload = z.object({ from: level.optional(), to: level });
const rolePayload = z.object({ role, from: text.nullish(), to: text.nullish() });
const servicesPayload = z.object({ added: z.array(text).optional(), removed: z.array(text).optional() });
const titlePayload = z.object({ from: text, to: text });

const readable = (type: string) => type.toLowerCase().replace(/_/g, " ");

/**
 * One readable sentence for a system event, in the active skin's words. Anything unexpected (a payload
 * that doesn't match, an unknown type, null, a string...) falls back to a generic line; this never throws.
 */
export function humanizeEvent(event: HumanizableEvent, ctx: HumanizeContext): string {
  const { t, nameOf, severityLabel } = ctx;
  const e = t.timeline.events;
  try {
    switch (event.type) {
      case "STATUS_CHANGED": {
        const p = statusPayload.safeParse(event.payload);
        if (!p.success) return e.generic(readable(event.type));
        if (p.data.created) return e.created(t.status[p.data.to]);
        return p.data.from
          ? e.statusChanged(t.status[p.data.from], t.status[p.data.to])
          : e.statusChangedTo(t.status[p.data.to]);
      }
      case "SEVERITY_CHANGED": {
        const p = severityPayload.safeParse(event.payload);
        if (!p.success) return e.generic(readable(event.type));
        const to = severityLabel(p.data.to);
        if (p.data.from === undefined) return e.severityChanged(to);
        const from = severityLabel(p.data.from);
        if (p.data.to > p.data.from) return e.severityRaised(from, to);
        if (p.data.to < p.data.from) return e.severityLowered(from, to);
        return e.severityChanged(to);
      }
      case "ROLE_ASSIGNED":
      case "ROLE_UNASSIGNED": {
        const p = rolePayload.safeParse(event.payload);
        if (!p.success) return e.roleChanged;
        const roleName = t.incidentRole[p.data.role as RoleKey];
        if (event.type === "ROLE_UNASSIGNED" || !p.data.to) {
          return p.data.from ? e.roleUnassigned(nameOf(p.data.from), roleName) : e.roleChanged;
        }
        return p.data.from
          ? e.roleReplaced(nameOf(p.data.to), roleName, nameOf(p.data.from))
          : e.roleAssigned(nameOf(p.data.to), roleName);
      }
      case "SERVICES_CHANGED": {
        const p = servicesPayload.safeParse(event.payload);
        if (!p.success) return e.servicesChanged;
        const parts = [
          p.data.added?.length ? e.servicesAdded(p.data.added) : null,
          p.data.removed?.length ? e.servicesRemoved(p.data.removed) : null,
        ].filter((x): x is string => x !== null);
        return parts.length > 0 ? parts.join(". ") : e.servicesChanged;
      }
      case "TITLE_CHANGED": {
        const p = titlePayload.safeParse(event.payload);
        return p.success ? e.titleChanged(p.data.from, p.data.to) : e.titleEdited;
      }
      case "SUMMARY_CHANGED":
        return e.summaryChanged;
      case "INCIDENT_DELETED":
        return e.incidentDeleted;
      case "REVENANT_LINKED":
        return e.revenantLinked;
      case "POSTMORTEM_PUBLISHED":
        return e.postmortemPublished;
      case "POSTMORTEM_STARTED":
        return e.postmortemStarted(nameOf(event.actorId));
      case "POSTMORTEM_UNPUBLISHED":
        return e.postmortemUnpublished;
      case "RITUAL_CREATED":
        return e.ritualCreated;
      case "RETRO_OVERRIDE":
        return e.retroOverride;
      case "EXTERNAL":
        return e.external;
      default:
        return e.generic(readable(String(event.type)));
    }
  } catch {
    return e.generic(readable(String(event?.type ?? "event")));
  }
}

/** Person ids a system event refers to, so the server can include their names in the response. */
export function referencedUserIds(event: HumanizableEvent): string[] {
  if (event.type !== "ROLE_ASSIGNED" && event.type !== "ROLE_UNASSIGNED") return [];
  const p = rolePayload.safeParse(event.payload);
  if (!p.success) return [];
  return [p.data.from, p.data.to].filter((x): x is string => typeof x === "string" && x.length > 0);
}
