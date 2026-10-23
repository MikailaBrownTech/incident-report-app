import { getCopy, severityName, type SeverityLevel } from "@/copy";
import { humanizeEvent } from "@/features/timeline/humanize";
import type { PersonView } from "@/features/incidents/schema";
import { Prisma, type Postmortem } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit";
import type { WorkspaceContext } from "@/server/auth/context";
import { hasRole } from "@/server/auth/permissions";
import { usersByIds } from "@/server/db/root";
import type { ScopedDb } from "@/server/db/tenant";
import {
  MAX_CONTENT_BYTES,
  docFromBullets,
  emptyContent,
  isMeaningful,
  readContent,
  validateContent,
  type ContentProblem,
  type Doc,
} from "./content";
import { markdownToDoc, stampUtc } from "./prefill";
import type { PostmortemPayload, PostmortemView } from "./schema";
import {
  BUILT_IN_TEMPLATES,
  builtInTemplate,
  defaultTemplateIdFor,
  type TemplateSection,
  type TemplateView,
} from "./sections";
import type { RuleLike } from "./status";

type Ctx = Pick<WorkspaceContext, "db" | "workspace" | "membership" | "user" | "skin">;

export type PostmortemError =
  | "not_found"
  | "exists"
  | "invalid_template"
  | "published"
  | "not_published"
  | "forbidden"
  | "conflict"
  | "invalid_content"
  | "too_large";

export type Failure =
  | { ok: false; error: Exclude<PostmortemError, "conflict" | "invalid_content" | "too_large"> }
  | { ok: false; error: "conflict"; latest: PostmortemPayload }
  | { ok: false; error: "invalid_content"; problem: ContentProblem }
  | { ok: false; error: "too_large" }
  | { ok: false; error: "missing_sections"; missing: string[] }
  | { ok: false; error: "exists"; number: number };
export type Result = { ok: true; payload: PostmortemPayload } | Failure;

/** Thrown inside a transaction so everything done so far rolls back. */
class Abort extends Error {
  constructor(readonly reason: "published" | "not_published") {
    super(reason);
  }
}

// ---- templates and rules ----------------------------------------------------------------------------------------

function customTemplateView(row: { id: string; name: string; isDefault: boolean; sections: unknown }): TemplateView {
  const sections = Array.isArray(row.sections) ? (row.sections as TemplateSection[]) : [];
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    builtIn: false,
    sections: [...sections].sort((a, b) => a.order - b.order),
  };
}

/** Built-in templates (the same for every workspace) followed by the workspace's own. */
export async function listTemplates(db: ScopedDb): Promise<TemplateView[]> {
  const custom = await db.postmortemTemplate.findMany({ where: { isSystem: false }, orderBy: { createdAt: "asc" } });
  return [...BUILT_IN_TEMPLATES, ...custom.map(customTemplateView)];
}

/** A built-in template, or one of THIS workspace's. Another workspace's template id is simply "not found". */
export async function resolveTemplate(db: ScopedDb, id: string): Promise<TemplateView | null> {
  const builtIn = builtInTemplate(id);
  if (builtIn) return builtIn;
  const row = await db.postmortemTemplate.findFirst({ where: { id, isSystem: false } });
  return row ? customTemplateView(row) : null;
}

export async function loadRetroRules(db: ScopedDb): Promise<RuleLike[]> {
  return db.retroRule.findMany({ select: { minSeverity: true, mode: true, dueInDays: true } });
}

// ---- views ------------------------------------------------------------------------------------------------------

export function toPostmortemView(pm: Postmortem, incidentNumber: number): PostmortemView {
  return {
    id: pm.id,
    incidentNumber,
    templateId: pm.templateId,
    status: pm.status,
    version: pm.version,
    sections: readContent(pm.content).sections,
    authorId: pm.authorId,
    publishedAt: pm.publishedAt?.toISOString() ?? null,
    publishedById: pm.publishedById,
    createdAt: pm.createdAt.toISOString(),
    updatedAt: pm.updatedAt.toISOString(),
  };
}

export async function peopleFor(ids: (string | null)[]): Promise<Record<string, PersonView>> {
  const users = await usersByIds(ids.filter((i): i is string => !!i));
  return Object.fromEntries(users.map((u) => [u.id, { userId: u.id, name: u.name, email: u.email, image: u.image }]));
}

async function payloadFor(ctx: Ctx, pm: Postmortem, number: number): Promise<PostmortemPayload> {
  const template =
    (await resolveTemplate(ctx.db, pm.templateId)) ?? builtInTemplate(pm.templateId) ?? BUILT_IN_TEMPLATES[0];
  return {
    postmortem: toPostmortemView(pm, number),
    template,
    people: await peopleFor([pm.authorId, pm.publishedById]),
  };
}

async function load(ctx: Ctx, number: number) {
  const incident = await ctx.db.incident.findFirst({
    where: { number },
    select: { id: true, number: true, summary: true, severity: true },
  });
  if (!incident) return null;
  const pm = await ctx.db.postmortem.findFirst({ where: { incidentId: incident.id } });
  return { incident, pm };
}

export async function getPostmortem(ctx: Ctx, number: number): Promise<PostmortemPayload | null> {
  const found = await load(ctx, number);
  if (!found?.pm) return null;
  return payloadFor(ctx, found.pm, number);
}

// ---- timeline snapshot ------------------------------------------------------------------------------------------

/**
 * The incident's key moments with timestamps, or its status changes when nobody marked any. A snapshot: the postmortem
 * keeps its own copy, editable, and offers "refresh" to take a new one.
 */
export async function timelineSnapshot(ctx: Ctx, incidentId: string): Promise<Doc> {
  const t = getCopy(ctx.skin);
  const events = await ctx.db.event.findMany({
    where: { incidentId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  const key = events.filter((e) => e.isKeyMoment);
  const lines = (key.length > 0 ? key : events.filter((e) => e.type === "STATUS_CHANGED")).map((e) => {
    const text =
      key.length > 0
        ? (e.body ?? "").trim().split("\n")[0].slice(0, 300)
        : humanizeEvent(e, {
            t,
            nameOf: () => "",
            severityLabel: (n) =>
              severityName(t, n as SeverityLevel, ctx.workspace.severityLabels as Record<string, string> | null),
          });
    return `${stampUtc(e.occurredAt)}: ${text}`;
  });
  return docFromBullets(lines);
}

export async function getTimelineSnapshot(ctx: Ctx, number: number): Promise<Doc | null> {
  const found = await load(ctx, number);
  return found ? timelineSnapshot(ctx, found.incident.id) : null;
}

// ---- create -----------------------------------------------------------------------------------------------------

export async function createPostmortem(ctx: Ctx, number: number, input: { templateId?: string }): Promise<Result> {
  const found = await load(ctx, number);
  if (!found) return { ok: false, error: "not_found" };
  if (found.pm) return { ok: false, error: "exists", number };

  const template = await resolveTemplate(ctx.db, input.templateId ?? defaultTemplateIdFor(found.incident.severity));
  if (!template) return { ok: false, error: "invalid_template" };

  const content = emptyContent();
  const keys = new Set(template.sections.map((s) => s.key));
  if (keys.has("summary") && found.incident.summary.trim()) {
    content.sections.summary = markdownToDoc(found.incident.summary);
  }
  if (keys.has("timeline")) {
    const doc = await timelineSnapshot(ctx, found.incident.id);
    if ((doc.content ?? []).length > 0) content.sections.timeline = doc;
  }

  try {
    const pm = await ctx.db.$transaction(async (tx) => {
      const created = await tx.postmortem.create({
        data: {
          workspaceId: ctx.workspace.id,
          incidentId: found.incident.id,
          templateId: template.id,
          authorId: ctx.user.id,
          content: content as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.event.create({
        data: {
          workspaceId: ctx.workspace.id,
          incidentId: found.incident.id,
          type: "POSTMORTEM_STARTED",
          source: "USER",
          actorId: ctx.user.id,
          payload: { postmortemId: created.id },
        },
      });
      return created;
    });
    return { ok: true, payload: await payloadFor(ctx, pm, number) };
  } catch (err) {
    // two people pressed "start" at once: the unique index on incidentId lets exactly one win
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "exists", number };
    }
    throw err;
  }
}

// ---- autosave ---------------------------------------------------------------------------------------------------

/**
 * Save some sections. Compare-and-set on `version`: the save only lands if the row still has the version the editor
 * loaded, and bumps it in the same statement, so two concurrent saves can never both succeed with the same version.
 * A stale save gets the latest content back and changes nothing.
 */
export async function savePostmortem(
  ctx: Ctx,
  number: number,
  input: { version: number; sections: Record<string, unknown> },
): Promise<Result> {
  const found = await load(ctx, number);
  if (!found?.pm) return { ok: false, error: "not_found" };
  const pm = found.pm;
  if (pm.status === "PUBLISHED") return { ok: false, error: "published" };
  if (pm.version !== input.version) return { ok: false, error: "conflict", latest: await payloadFor(ctx, pm, number) };

  const template = await resolveTemplate(ctx.db, pm.templateId);
  const allowed = (template ?? builtInTemplate(pm.templateId))?.sections.map((s) => s.key) ?? [];
  // validate what was sent, then the whole merged document (the size limit applies to the total)
  const sent = validateContent(input.sections, allowed);
  if (!sent.ok) return sent.error.code === "too_large" ? { ok: false, error: "too_large" } : invalid(sent.error);
  const merged = { ...readContent(pm.content).sections, ...sent.sections };
  const total = validateContent(merged, allowed);
  if (!total.ok) return total.error.code === "too_large" ? { ok: false, error: "too_large" } : invalid(total.error);

  const { count } = await ctx.db.postmortem.updateMany({
    where: { id: pm.id, version: input.version, status: "DRAFT" },
    data: { content: { sections: total.sections } as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
  const latest = await ctx.db.postmortem.findFirst({ where: { id: pm.id } });
  if (!latest) return { ok: false, error: "not_found" };
  if (count === 0) {
    if (latest.status === "PUBLISHED") return { ok: false, error: "published" };
    return { ok: false, error: "conflict", latest: await payloadFor(ctx, latest, number) };
  }
  return { ok: true, payload: await payloadFor(ctx, latest, number) };
}

const invalid = (problem: ContentProblem): Failure => ({ ok: false, error: "invalid_content", problem });
export { MAX_CONTENT_BYTES };

// ---- publish / unpublish ----------------------------------------------------------------------------------------

export async function publishPostmortem(ctx: Ctx, number: number, now: Date = new Date()): Promise<Result> {
  const found = await load(ctx, number);
  if (!found?.pm) return { ok: false, error: "not_found" };
  const pm = found.pm;
  if (pm.status === "PUBLISHED") return { ok: false, error: "published" };

  const template = (await resolveTemplate(ctx.db, pm.templateId)) ?? builtInTemplate(pm.templateId);
  const content = readContent(pm.content);
  const missing = (template?.sections ?? [])
    .filter((s) => s.required && !isMeaningful(content.sections[s.key]))
    .map((s) => s.key);
  if (missing.length > 0) return { ok: false, error: "missing_sections", missing };

  try {
    await ctx.db.$transaction(async (tx) => {
      const { count } = await tx.postmortem.updateMany({
        where: { id: pm.id, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt: now, publishedById: ctx.user.id, version: { increment: 1 } },
      });
      if (count === 0) throw new Abort("published"); // published by someone else a moment ago
      await tx.event.create({
        data: {
          workspaceId: ctx.workspace.id,
          incidentId: found.incident.id,
          type: "POSTMORTEM_PUBLISHED",
          source: "USER",
          actorId: ctx.user.id,
          payload: { postmortemId: pm.id },
        },
      });
      await writeAudit(tx, ctx.workspace.id, {
        actorId: ctx.user.id,
        action: "postmortem.published",
        targetType: "postmortem",
        targetId: pm.id,
        metadata: { number },
      });
    });
  } catch (err) {
    if (err instanceof Abort) return { ok: false, error: "published" };
    throw err;
  }
  const latest = await ctx.db.postmortem.findFirstOrThrow({ where: { id: pm.id } });
  return { ok: true, payload: await payloadFor(ctx, latest, number) };
}

/** Admins and owners only. Returns the postmortem to DRAFT so it can be edited and published again. */
export async function unpublishPostmortem(ctx: Ctx, number: number): Promise<Result> {
  if (!hasRole(ctx.membership.role, "ADMIN")) return { ok: false, error: "forbidden" };
  const found = await load(ctx, number);
  if (!found?.pm) return { ok: false, error: "not_found" };
  const pm = found.pm;
  if (pm.status !== "PUBLISHED") return { ok: false, error: "not_published" };

  try {
    await ctx.db.$transaction(async (tx) => {
      const { count } = await tx.postmortem.updateMany({
        where: { id: pm.id, status: "PUBLISHED" },
        data: { status: "DRAFT", publishedAt: null, publishedById: null, version: { increment: 1 } },
      });
      if (count === 0) throw new Abort("not_published");
      await tx.event.create({
        data: {
          workspaceId: ctx.workspace.id,
          incidentId: found.incident.id,
          type: "POSTMORTEM_UNPUBLISHED",
          source: "USER",
          actorId: ctx.user.id,
          payload: { postmortemId: pm.id },
        },
      });
      await writeAudit(tx, ctx.workspace.id, {
        actorId: ctx.user.id,
        action: "postmortem.unpublished",
        targetType: "postmortem",
        targetId: pm.id,
        metadata: { number },
      });
    });
  } catch (err) {
    if (err instanceof Abort) return { ok: false, error: "not_published" };
    throw err;
  }
  const latest = await ctx.db.postmortem.findFirstOrThrow({ where: { id: pm.id } });
  return { ok: true, payload: await payloadFor(ctx, latest, number) };
}
