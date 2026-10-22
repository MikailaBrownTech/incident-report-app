import { describe, expect, it, vi } from "vitest";
import * as incidents from "@/app/api/w/[slug]/incidents/route";
import { prisma } from "@/server/db/client";
import { call } from "@/test/api";
import { addMember, createTeam } from "@/test/fixtures";

vi.mock("@/server/auth/session", async () => {
  const { currentTestUser } = await import("@/test/api");
  return { getSession: async () => (currentTestUser() ? { user: currentTestUser(), session: {} } : null) };
});

async function world() {
  const a = await createTeam("inc-a");
  const admin = await addMember(a.workspace.id, "ADMIN");
  const member = await addMember(a.workspace.id, "MEMBER");
  const b = await createTeam("inc-b");
  const svc = (name: string, workspaceId = a.workspace.id) =>
    prisma.service.create({ data: { workspaceId, name, slug: name.toLowerCase() } });
  return { a, admin, member, b, svc, slug: a.workspace.slug, wsId: a.workspace.id };
}
type World = Awaited<ReturnType<typeof world>>;

const declare = (w: World, user: Parameters<typeof call>[0], body: unknown, slug = w.slug) =>
  call(user, incidents.POST, `/api/w/${slug}/incidents`, { method: "POST", body, params: { slug } });

const valid = { title: "Checkout is down", severity: 3 };

describe("declaring an incident", () => {
  it.concurrent("any member can; records the creator, numbers it, links services, and logs event + audit", async () => {
    const w = await world();
    const [api, db] = [await w.svc("API"), await w.svc("DB")];
    const started = new Date(Date.now() - 3_600_000).toISOString();

    const res = await declare(w, w.member, {
      ...valid,
      summary: "  Users see 500s  ",
      severity: 4,
      serviceIds: [api.id, db.id, api.id],
      startedAt: started,
      status: "IDENTIFIED",
    });
    expect(res.status).toBe(201);
    expect(res.body.incident).toMatchObject({ number: 1 });

    const row = await prisma.incident.findUniqueOrThrow({
      where: { id: res.body.incident.id },
      include: { services: true, assignments: true, events: true },
    });
    expect(row).toMatchObject({
      number: 1,
      title: "Checkout is down",
      summary: "Users see 500s",
      severity: 4,
      status: "IDENTIFIED",
      createdById: w.member.id,
      resolvedAt: null,
    });
    expect(row.startedAt.toISOString()).toBe(started);
    expect(row.services.map((s) => s.serviceId).sort()).toEqual([api.id, db.id].sort()); // deduplicated
    expect(row.assignments).toEqual([]); // the creator is NOT made commander

    expect(row.events).toHaveLength(1);
    expect(row.events[0]).toMatchObject({
      type: "STATUS_CHANGED",
      source: "SYSTEM",
      actorId: w.member.id,
      payload: { to: "IDENTIFIED", created: true },
    });
    expect(row.events[0].occurredAt.toISOString()).toBe(started);

    const audit = await prisma.auditLog.findMany({ where: { workspaceId: w.wsId, action: "incident.created" } });
    expect(audit).toEqual([
      expect.objectContaining({
        actorId: w.member.id,
        targetType: "incident",
        targetId: row.id,
        metadata: { number: 1, severity: 4, status: "IDENTIFIED" },
      }),
    ]);
  });

  it.concurrent("defaults: INVESTIGATING, started now, no services, empty summary", async () => {
    const w = await world();
    const before = Date.now();
    const res = await declare(w, w.a.owner, valid);
    expect(res.status).toBe(201);
    const row = await prisma.incident.findUniqueOrThrow({
      where: { id: res.body.incident.id },
      include: { services: true },
    });
    expect(row).toMatchObject({ status: "INVESTIGATING", summary: "" });
    expect(row.services).toEqual([]);
    expect(Math.abs(row.startedAt.getTime() - before)).toBeLessThan(10_000);
  });

  it.concurrent("allocates distinct, gapless numbers under concurrency", async () => {
    const w = await world();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => declare(w, w.member, { ...valid, title: `n${i}` })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.incident.number as number).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: w.wsId } })).nextIncidentNumber).toBe(13);
    // numbering is per workspace
    const other = await declare(w, w.b.owner, valid, w.b.workspace.slug);
    expect(other.body.incident.number).toBe(1);
  });

  it.concurrent("validates the body with field error codes", async () => {
    const w = await world();
    const cases: [string, unknown, string][] = [
      ["title", { ...valid, title: "" }, "title"],
      ["title", { ...valid, title: "   " }, "title"],
      ["title", { ...valid, title: "x".repeat(141) }, "title"],
      ["title", { severity: 3 }, "title"],
      ["severity", { ...valid, severity: 0 }, "severity"],
      ["severity", { ...valid, severity: 6 }, "severity"],
      ["severity", { ...valid, severity: 2.5 }, "severity"],
      ["severity", { ...valid, severity: "3" }, "severity"],
      ["severity", { title: "x" }, "severity"],
      ["status", { ...valid, status: "RESOLVED" }, "status"],
      ["status", { ...valid, status: "nope" }, "status"],
      ["startedAt", { ...valid, startedAt: "yesterday" }, "startedAt"],
      ["summary", { ...valid, summary: "s".repeat(20_001) }, "summary"],
    ];
    for (const [label, body, field] of cases) {
      const res = await declare(w, w.member, body);
      expect(res.status, `${label}: ${JSON.stringify(body).slice(0, 60)}`).toBe(400);
      expect(res.body.error.code).toBe("validation_error");
      expect(res.body.error.fieldErrors[field]).toBeTruthy();
    }
    expect((await declare(w, w.member, { ...valid, title: "x".repeat(140) })).status).toBe(201);
    for (const severity of [1, 5]) expect((await declare(w, w.member, { ...valid, severity })).status).toBe(201);
    expect(await prisma.incident.count({ where: { workspaceId: w.wsId } })).toBe(3);
  });

  it.concurrent("rejects start times in the future, accepts backfill into the past", async () => {
    const w = await world();
    const future = await declare(w, w.member, { ...valid, startedAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(future.status).toBe(400);
    expect(future.body.error.fieldErrors.startedAt).toEqual(["in_future"]);
    const slight = await declare(w, w.member, { ...valid, startedAt: new Date(Date.now() + 60_000).toISOString() });
    expect(slight.status).toBe(201); // within clock-skew tolerance
    const past = await declare(w, w.member, { ...valid, startedAt: "2020-01-02T03:04:05Z" });
    expect(past.status).toBe(201);
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: past.body.incident.id } });
    expect(row.startedAt.toISOString()).toBe("2020-01-02T03:04:05.000Z");
    expect((await declare(w, w.member, { ...valid, startedAt: "2020-06-01T10:00:00+02:00" })).status).toBe(201);
  });

  it.concurrent(
    "rejects services that don't exist or belong to another workspace, leaving nothing behind",
    async () => {
      const w = await world();
      const mine = await w.svc("Mine");
      const theirs = await w.svc("Theirs", w.b.workspace.id);

      for (const serviceIds of [[theirs.id], [mine.id, theirs.id], ["nope"]]) {
        const res = await declare(w, w.member, { ...valid, serviceIds });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({
          code: "invalid_service",
          fieldErrors: { serviceIds: ["invalid_service"] },
        });
      }
      expect(await prisma.incident.count({ where: { workspaceId: w.wsId } })).toBe(0);
      // failed attempts did not consume a number
      const ok = await declare(w, w.member, valid);
      expect(ok.body.incident.number).toBe(1);
      expect(await prisma.incidentService.count({ where: { serviceId: theirs.id } })).toBe(0);
    },
  );

  it.concurrent("admins can create services inline; members can't; a clash rolls everything back", async () => {
    const w = await world();
    await w.svc("Existing");

    const made = await declare(w, w.admin, { ...valid, newServiceNames: ["Billing", "Billing", "Email Gateway"] });
    expect(made.status).toBe(201);
    const linked = await prisma.incidentService.findMany({
      where: { incidentId: made.body.incident.id },
      include: { service: true },
    });
    expect(linked.map((l) => l.service.name).sort()).toEqual(["Billing", "Email Gateway"]);
    expect(linked.map((l) => l.service.slug).sort()).toEqual(["billing", "email-gateway"]);

    const denied = await declare(w, w.member, { ...valid, newServiceNames: ["Sneaky"] });
    expect(denied.status).toBe(403);
    expect(await prisma.service.count({ where: { workspaceId: w.wsId, name: "Sneaky" } })).toBe(0);

    const before = await prisma.workspace.findUniqueOrThrow({ where: { id: w.wsId } });
    const clash = await declare(w, w.admin, { ...valid, newServiceNames: ["Fresh One", "existing"] });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("name_taken");
    expect(await prisma.service.count({ where: { workspaceId: w.wsId, name: "Fresh One" } })).toBe(0); // rolled back
    const after = await prisma.workspace.findUniqueOrThrow({ where: { id: w.wsId } });
    expect(after.nextIncidentNumber).toBe(before.nextIncidentNumber); // number not burned
  });

  it.concurrent("non-members get 404, signed-out callers 401, bad JSON 400, and nothing is written", async () => {
    const w = await world();
    expect((await declare(w, w.b.owner, valid)).status).toBe(404);
    expect((await declare(w, null, valid)).status).toBe(401);
    const bad = await call(w.member, incidents.POST, `/api/w/${w.slug}/incidents`, {
      method: "POST",
      body: undefined,
      params: { slug: w.slug },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_json");
    expect(await prisma.incident.count({ where: { workspaceId: w.wsId } })).toBe(0);
    expect(await prisma.incident.count({ where: { workspaceId: w.b.workspace.id } })).toBe(0);
  });

  it.concurrent("the database itself enforces severity 1..5", async () => {
    const w = await world();
    for (const severity of [0, 6, -1, 99]) {
      await expect(
        prisma.incident.create({
          data: { workspaceId: w.wsId, number: 900 + severity, title: "bad", severity, createdById: w.a.owner.id },
        }),
      ).rejects.toThrow();
    }
    await expect(
      prisma.incident.create({
        data: { workspaceId: w.wsId, number: 777, title: "ok", severity: 5, createdById: w.a.owner.id },
      }),
    ).resolves.toBeTruthy();
  });

  it.concurrent("the trigram index exists on incident titles", async () => {
    // information_schema can't see opclasses, so ask pg_indexes (scoped to this run's schema)
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      select indexdef from pg_indexes where indexname = 'incident_title_trgm' and schemaname = current_schema()`;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/gin/i);
    expect(rows[0].indexdef).toMatch(/gin_trgm_ops/);
  });
});
