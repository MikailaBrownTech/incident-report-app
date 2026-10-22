import { Prisma } from "@/generated/prisma/client";
import type { WorkspaceContext } from "@/server/auth/context";
import type { ScopedDb } from "@/server/db/tenant";
import { slugify } from "@/features/workspaces/slug";
import type { ServiceView } from "./schema";

export type ServiceError = "name_taken" | "not_found";

type Db = Pick<ScopedDb, "service">;

/** First free slug for `name`: `api`, `api-2`, `api-3`, ... (stable once assigned). */
export async function allocateServiceSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name) || "service";
  const taken = new Set(
    (await db.service.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((s) => s.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const nameTaken = (db: Db, name: string, exceptId?: string) =>
  db.service.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });

export async function createService(ctx: Pick<WorkspaceContext, "db" | "workspace">, name: string) {
  return createServiceIn(ctx.db, ctx.workspace.id, name);
}

/** Usable with a transaction client too (declaring an incident can create services inline). */
export async function createServiceIn(
  db: Pick<ScopedDb, "service">,
  workspaceId: string,
  name: string,
): Promise<{ ok: true; service: { id: string; name: string; slug: string } } | { ok: false; error: "name_taken" }> {
  if (await nameTaken(db, name)) return { ok: false, error: "name_taken" };
  try {
    const service = await db.service.create({
      data: { workspaceId, name, slug: await allocateServiceSlug(db, name) },
      select: { id: true, name: true, slug: true },
    });
    return { ok: true, service };
  } catch (err) {
    // A concurrent create took the name or slug between our check and the insert.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "name_taken" };
    }
    throw err;
  }
}

export async function renameService(ctx: Pick<WorkspaceContext, "db">, id: string, name: string) {
  const current = await ctx.db.service.findFirst({ where: { id }, select: { id: true } });
  if (!current) return { ok: false, error: "not_found" } as const;
  if (await nameTaken(ctx.db, name, id)) return { ok: false, error: "name_taken" } as const;
  try {
    // The slug is deliberately left alone so existing links and references keep working.
    await ctx.db.service.update({ where: { id }, data: { name } });
    return { ok: true } as const;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "name_taken" } as const;
    }
    throw err;
  }
}

/** Deletes the service and its links to incidents (the incidents themselves stay). */
export async function deleteService(ctx: Pick<WorkspaceContext, "db">, id: string) {
  const service = await ctx.db.service.findFirst({
    where: { id },
    select: { _count: { select: { incidents: { where: { incident: { deletedAt: null } } } } } },
  });
  if (!service) return { ok: false, error: "not_found" } as const;
  await ctx.db.service.delete({ where: { id } });
  return { ok: true, unlinkedIncidents: service._count.incidents } as const;
}

export async function listServices(db: ScopedDb): Promise<ServiceView[]> {
  const [services, open] = await Promise.all([
    db.service.findMany({
      orderBy: { name: "asc" },
      // Nested relation filters bypass the scoped client's soft-delete rule, so exclude deleted incidents here.
      include: { _count: { select: { incidents: { where: { incident: { deletedAt: null } } } } } },
    }),
    db.incidentService.groupBy({
      by: ["serviceId"],
      where: { incident: { status: { not: "RESOLVED" }, deletedAt: null } },
      _count: { _all: true },
    }),
  ]);
  const openByService = new Map(open.map((o) => [o.serviceId, o._count._all]));
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    createdAt: s.createdAt.toISOString(),
    openIncidents: openByService.get(s.id) ?? 0,
    totalIncidents: s._count.incidents,
  }));
}
