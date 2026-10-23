import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { docFromBullets, docFromParagraphs, type Doc } from "@/features/postmortems/content";
import { BUILT_IN_TEMPLATES, defaultTemplateIdFor } from "@/features/postmortems/sections";

/**
 * Seeded postmortems, shared by the demo seed and `seed:mine`. Content is written as plain strings per section
 * (a string is a paragraph, an array is a bullet list) and turned into the rich-text documents the editor stores.
 */

export type SectionText = string | string[];

export interface SeedPostmortem {
  status: "PUBLISHED" | "DRAFT";
  /** Defaults to the template that suits the incident's severity. */
  templateId?: string;
  sections: Record<string, SectionText>;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

const toDoc = (text: SectionText): Doc => (Array.isArray(text) ? docFromBullets(text) : docFromParagraphs([text]));

export interface EnsureInput {
  workspaceId: string;
  incident: { id: string; number: number; severity: number; resolvedAt: Date | null };
  spec: SeedPostmortem;
  authorId: string;
  publisherId: string;
  now: Date;
}

/**
 * Creates the postmortem (and its timeline events and audit row) unless the incident already has one, so running a
 * seed again adds nothing and never overwrites what people wrote. Returns whether it created one.
 */
export async function ensureSeedPostmortem(db: PrismaClient, input: EnsureInput): Promise<boolean> {
  const { workspaceId, incident, spec, authorId, publisherId, now } = input;
  const existing = await db.postmortem.findUnique({ where: { incidentId: incident.id }, select: { id: true } });
  if (existing) return false;

  const templateId = spec.templateId ?? defaultTemplateIdFor(incident.severity);
  const template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId)!;
  const allowed = new Set(template.sections.map((s) => s.key));
  const sections: Record<string, Doc> = {};
  for (const [key, text] of Object.entries(spec.sections)) {
    if (!allowed.has(key)) throw new Error(`seed postmortem: "${key}" is not a section of ${templateId}`);
    sections[key] = toDoc(text);
  }

  // started a few hours after resolution; published the next day (never in the future)
  const base = incident.resolvedAt ?? now;
  const startedAt = new Date(Math.min(base.getTime() + 3 * HOUR, now.getTime()));
  const publishedAt =
    spec.status === "PUBLISHED" ? new Date(Math.min(base.getTime() + 28 * HOUR, now.getTime())) : null;

  await db.$transaction(async (tx) => {
    const pm = await tx.postmortem.create({
      data: {
        workspaceId,
        incidentId: incident.id,
        templateId,
        authorId,
        status: spec.status,
        publishedAt,
        publishedById: publishedAt ? publisherId : null,
        content: { sections } as unknown as Prisma.InputJsonValue,
        version: publishedAt ? 3 : 2,
        createdAt: startedAt,
        updatedAt: publishedAt ?? startedAt,
      },
    });
    const event = (type: "POSTMORTEM_STARTED" | "POSTMORTEM_PUBLISHED", actorId: string, at: Date) =>
      tx.event.create({
        data: {
          workspaceId,
          incidentId: incident.id,
          type,
          source: "USER",
          actorId,
          payload: { postmortemId: pm.id },
          occurredAt: at,
          createdAt: at,
          updatedAt: at,
        },
      });
    await event("POSTMORTEM_STARTED", authorId, startedAt);
    if (publishedAt) {
      await event("POSTMORTEM_PUBLISHED", publisherId, publishedAt);
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: publisherId,
          action: "postmortem.published",
          targetType: "postmortem",
          targetId: pm.id,
          metadata: { number: incident.number, seeded: true },
          createdAt: publishedAt,
        },
      });
    }
  });
  return true;
}
