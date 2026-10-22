import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as service from "@/app/api/w/[slug]/services/[id]/route";
import * as services from "@/app/api/w/[slug]/services/route";
import { prisma } from "@/server/db/client";
import { call } from "@/test/api";
import { addMember, createTeam } from "@/test/fixtures";

vi.mock("@/server/auth/session", async () => {
  const { currentTestUser } = await import("@/test/api");
  return { getSession: async () => (currentTestUser() ? { user: currentTestUser(), session: {} } : null) };
});

const uid = () => randomBytes(3).toString("hex");
const P = (slug: string) => `/api/w/${slug}/services`;

async function world() {
  const a = await createTeam("svc-a");
  const admin = await addMember(a.workspace.id, "ADMIN");
  const member = await addMember(a.workspace.id, "MEMBER");
  const b = await createTeam("svc-b");
  return { a, admin, member, b, slug: a.workspace.slug };
}
type World = Awaited<ReturnType<typeof world>>;

const create = (w: World, user: Parameters<typeof call>[0], name: unknown) =>
  call(user, services.POST, P(w.slug), { method: "POST", body: { name }, params: { slug: w.slug } });

describe("services", () => {
  it.concurrent("admins and owners create services; the slug is generated and unique per workspace", async () => {
    const w = await world();
    const first = await create(w, w.admin, "Payments API");
    expect(first.status).toBe(201);
    expect(first.body.service).toMatchObject({ name: "Payments API", slug: "payments-api" });

    // different name, same slug base: gets a numbered slug instead of failing
    const second = await create(w, w.a.owner, "payments.api");
    expect(second.status).toBe(201);
    expect(second.body.service.slug).toBe("payments-api-2");
    const third = await create(w, w.a.owner, "Payments/API");
    expect(third.body.service.slug).toBe("payments-api-3");

    // punctuation and accents are normalised
    const odd = await create(w, w.a.owner, "  Café / Édge!!  ");
    expect(odd.body.service.slug).toBe("cafe-edge");

    // the same slug is fine in another workspace
    const other = await call(w.b.owner, services.POST, P(w.b.workspace.slug), {
      method: "POST",
      body: { name: "Payments API" },
      params: { slug: w.b.workspace.slug },
    });
    expect(other.status).toBe(201);
    expect(other.body.service.slug).toBe("payments-api");
  });

  it.concurrent("rejects duplicate names case-insensitively, and bad names", async () => {
    const w = await world();
    expect((await create(w, w.admin, "Checkout")).status).toBe(201);
    const dup = await create(w, w.admin, "checkout");
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: "name_taken", fieldErrors: { name: ["name_taken"] } });

    for (const bad of ["", "   ", "x".repeat(61), undefined, 5]) {
      const res = await create(w, w.admin, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error.code).toBe("validation_error");
    }
    expect((await create(w, w.admin, "x".repeat(60))).status).toBe(201);
  });

  it.concurrent("two simultaneous creates of the same name make exactly one", async () => {
    const w = await world();
    const name = `Race ${uid()}`;
    const results = await Promise.all([create(w, w.admin, name), create(w, w.a.owner, name)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.service.count({ where: { workspaceId: w.a.workspace.id, name } })).toBe(1);
  });

  it.concurrent("members can read but not create, rename or delete; non-members get 404", async () => {
    const w = await world();
    const made = await create(w, w.admin, "Search");
    const id = made.body.service.id as string;

    const read = await call(w.member, services.GET, P(w.slug), { params: { slug: w.slug } });
    expect(read.status).toBe(200);
    expect(read.body.services.map((s: { name: string }) => s.name)).toContain("Search");

    expect((await create(w, w.member, "Nope")).status).toBe(403);
    const patch = await call(w.member, service.PATCH, `${P(w.slug)}/${id}`, {
      method: "PATCH",
      body: { name: "Hacked" },
      params: { slug: w.slug, id },
    });
    expect(patch.status).toBe(403);
    const del = await call(w.member, service.DELETE, `${P(w.slug)}/${id}`, {
      method: "DELETE",
      params: { slug: w.slug, id },
    });
    expect(del.status).toBe(403);

    for (const [handler, init] of [
      [services.GET, { params: { slug: w.slug } }],
      [services.POST, { method: "POST", body: { name: "X" }, params: { slug: w.slug } }],
      [service.PATCH, { method: "PATCH", body: { name: "X" }, params: { slug: w.slug, id } }],
      [service.DELETE, { method: "DELETE", params: { slug: w.slug, id } }],
    ] as const) {
      expect((await call(w.b.owner, handler, `${P(w.slug)}/${id}`, init)).status).toBe(404);
      expect((await call(null, handler, `${P(w.slug)}/${id}`, init)).status).toBe(401);
    }
    expect((await prisma.service.findUniqueOrThrow({ where: { id } })).name).toBe("Search");
  });

  it.concurrent("rename keeps the slug; renaming to a taken name or a missing id fails", async () => {
    const w = await world();
    const a = (await create(w, w.admin, "Alpha")).body.service;
    await create(w, w.admin, "Beta");

    const ok = await call(w.admin, service.PATCH, `${P(w.slug)}/${a.id}`, {
      method: "PATCH",
      body: { name: "Alpha Prime" },
      params: { slug: w.slug, id: a.id },
    });
    expect(ok.status).toBe(200);
    const row = await prisma.service.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ name: "Alpha Prime", slug: "alpha" });

    // renaming to its own name (or a case variant of it) is allowed
    expect(
      (
        await call(w.admin, service.PATCH, `${P(w.slug)}/${a.id}`, {
          method: "PATCH",
          body: { name: "alpha prime" },
          params: { slug: w.slug, id: a.id },
        })
      ).status,
    ).toBe(200);

    const clash = await call(w.admin, service.PATCH, `${P(w.slug)}/${a.id}`, {
      method: "PATCH",
      body: { name: "beta" },
      params: { slug: w.slug, id: a.id },
    });
    expect(clash.status).toBe(409);
    const missing = await call(w.admin, service.PATCH, `${P(w.slug)}/nope`, {
      method: "PATCH",
      body: { name: "Whatever" },
      params: { slug: w.slug, id: "nope" },
    });
    expect(missing.status).toBe(404);
  });

  it.concurrent("another workspace's admin cannot rename or delete this workspace's service", async () => {
    const w = await world();
    const a = (await create(w, w.admin, "Mine")).body.service;
    const bSlug = w.b.workspace.slug;
    const patch = await call(w.b.owner, service.PATCH, `${P(bSlug)}/${a.id}`, {
      method: "PATCH",
      body: { name: "Stolen" },
      params: { slug: bSlug, id: a.id },
    });
    const del = await call(w.b.owner, service.DELETE, `${P(bSlug)}/${a.id}`, {
      method: "DELETE",
      params: { slug: bSlug, id: a.id },
    });
    expect([patch.status, del.status]).toEqual([404, 404]);
    expect(await prisma.service.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ name: "Mine" });
  });

  it.concurrent("lists open and total incident counts; deleting unlinks incidents but keeps them", async () => {
    const w = await world();
    const svc = (await create(w, w.admin, "Ledger")).body.service;
    const idle = (await create(w, w.admin, "Idle")).body.service;
    const wsId = w.a.workspace.id;
    const mk = (number: number, status: "INVESTIGATING" | "RESOLVED") =>
      prisma.incident.create({
        data: {
          workspaceId: wsId,
          number,
          title: `i${number}`,
          severity: 2,
          status,
          createdById: w.a.owner.id,
          services: { create: { serviceId: svc.id } },
        },
      });
    const [open1, open2, done] = [await mk(1, "INVESTIGATING"), await mk(2, "INVESTIGATING"), await mk(3, "RESOLVED")];

    const list = await call(w.member, services.GET, P(w.slug), { params: { slug: w.slug } });
    const byName = Object.fromEntries(list.body.services.map((s: { name: string }) => [s.name, s]));
    expect(byName.Ledger).toMatchObject({ openIncidents: 2, totalIncidents: 3, slug: "ledger" });
    expect(byName.Idle).toMatchObject({ openIncidents: 0, totalIncidents: 0 });
    expect(typeof byName.Ledger.createdAt).toBe("string");
    expect(idle.id).toBeTruthy();

    const del = await call(w.admin, service.DELETE, `${P(w.slug)}/${svc.id}`, {
      method: "DELETE",
      params: { slug: w.slug, id: svc.id },
    });
    expect(del.body).toEqual({ deleted: true, unlinkedIncidents: 3 });
    expect(await prisma.service.count({ where: { id: svc.id } })).toBe(0);
    expect(await prisma.incidentService.count({ where: { serviceId: svc.id } })).toBe(0);
    expect(await prisma.incident.count({ where: { id: { in: [open1.id, open2.id, done.id] } } })).toBe(3);

    expect(
      (
        await call(w.admin, service.DELETE, `${P(w.slug)}/${svc.id}`, {
          method: "DELETE",
          params: { slug: w.slug, id: svc.id },
        })
      ).status,
    ).toBe(404);
  });
});
