import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import type { WorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";
import { findLiveIncident, toView } from "./queries";
import { FUTURE_SKEW_MS, canModifyNote, isManualNote, type TimelineEventView } from "./schema";

type Ctx = Pick<WorkspaceContext, "db" | "workspace" | "membership" | "user">;

export type NoteError = "not_found" | "forbidden" | "event_immutable" | "in_future";
export type NoteResult = { ok: true; event: TimelineEventView } | { ok: false; error: NoteError };
export type DeleteResult = { ok: true } | { ok: false; error: NoteError };

const isFuture = (when: Date, now: Date) => when.getTime() > now.getTime() + FUTURE_SKEW_MS;
const isAdmin = (ctx: Ctx) => hasRole(ctx.membership.role, "ADMIN");

/**
 * Add a note. `createdAt` is always the server's clock (the column default); `occurredAt` defaults to now and may be
 * any past time (backfill), including before the incident started, but never in the future.
 */
export async function createNote(
  ctx: Ctx,
  number: number,
  input: { body: string; occurredAt?: string; isKeyMoment: boolean },
  now: Date = new Date(),
): Promise<NoteResult> {
  const incident = await findLiveIncident(ctx.db, number);
  if (!incident) return { ok: false, error: "not_found" };

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  if (isFuture(occurredAt, now)) return { ok: false, error: "in_future" };

  const event = await ctx.db.event.create({
    data: {
      workspaceId: ctx.workspace.id,
      incidentId: incident.id,
      type: "NOTE",
      source: "USER",
      actorId: ctx.user.id,
      body: input.body,
      occurredAt,
      isKeyMoment: input.isKeyMoment,
    },
  });
  return { ok: true, event: toView(event) };
}

/** Looks the note up inside this incident (an id from another incident or workspace is simply "not found"). */
async function loadNote(ctx: Ctx, number: number, id: string) {
  const incident = await findLiveIncident(ctx.db, number);
  if (!incident) return null;
  const event = await ctx.db.event.findFirst({ where: { id, incidentId: incident.id } });
  return event ? { incident, event } : null;
}

/** Shared by edit and delete: system events are immutable; notes belong to their author and to admins. */
function checkAccess(ctx: Ctx, event: { type: string; source: string; actorId: string | null }): NoteError | null {
  if (!isManualNote(event)) return "event_immutable";
  if (!canModifyNote(event, ctx.user.id, isAdmin(ctx))) return "forbidden";
  return null;
}

/**
 * Edit a note's text, time and/or key-moment flag. Editing the text or time stamps `editedAt`; starring alone doesn't,
 * since that isn't a change to what the note says. Never creates a timeline event.
 */
export async function updateNote(
  ctx: Ctx,
  number: number,
  id: string,
  patch: { body?: string; occurredAt?: string; isKeyMoment?: boolean },
  now: Date = new Date(),
): Promise<NoteResult> {
  const found = await loadNote(ctx, number, id);
  if (!found) return { ok: false, error: "not_found" };
  const denied = checkAccess(ctx, found.event);
  if (denied) return { ok: false, error: denied };

  const data: Prisma.EventUpdateInput = {};
  let content = false;

  if (patch.body !== undefined && patch.body !== found.event.body) {
    data.body = patch.body;
    content = true;
  }
  if (patch.occurredAt !== undefined) {
    const when = new Date(patch.occurredAt);
    if (isFuture(when, now)) return { ok: false, error: "in_future" };
    if (when.getTime() !== found.event.occurredAt.getTime()) {
      data.occurredAt = when;
      content = true;
    }
  }
  if (patch.isKeyMoment !== undefined && patch.isKeyMoment !== found.event.isKeyMoment) {
    data.isKeyMoment = patch.isKeyMoment;
  }
  if (content) data.editedAt = now;

  if (Object.keys(data).length === 0) return { ok: true, event: toView(found.event) };
  const event = await ctx.db.event.update({ where: { id }, data });
  return { ok: true, event: toView(event) };
}

/**
 * Permanently delete a note. The audit row records which note and which incident, never what it said.
 */
export async function deleteNote(ctx: Ctx, number: number, id: string): Promise<DeleteResult> {
  const found = await loadNote(ctx, number, id);
  if (!found) return { ok: false, error: "not_found" };
  const denied = checkAccess(ctx, found.event);
  if (denied) return { ok: false, error: denied };

  await ctx.db.$transaction(async (tx) => {
    await tx.event.delete({ where: { id } });
    await writeAudit(tx, ctx.workspace.id, {
      actorId: ctx.user.id,
      action: "incident.note_deleted",
      targetType: "incident",
      targetId: found.incident.id,
      metadata: { number, noteId: id },
    });
  });
  return { ok: true };
}
