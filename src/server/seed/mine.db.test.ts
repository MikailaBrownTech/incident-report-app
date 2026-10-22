import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createUser } from "@/test/fixtures";
import { loadFixture, SeedMineError, seedKeyOf, seedMine, type MinePlan } from "./mine";

const NOW = new Date("2026-06-15T12:00:00Z");
const yes = async () => true;

async function userWithWorkspace(name: string, members = 0) {
  const me = await createUser(name);
  const ws = await prisma.workspace.create({
    data: { name: `${name} ws`, slug: `${name}-${Math.random().toString(36).slice(2, 8)}` },
  });
  await prisma.membership.create({ data: { workspaceId: ws.id, userId: me.id, role: "OWNER" } });
  const others = [];
  for (let i = 0; i < members; i += 1) {
    const u = await createUser(`${name}-m${i}`);
    await prisma.membership.create({ data: { workspaceId: ws.id, userId: u.id, role: "MEMBER" } });
    others.push(u);
  }
  return { me, ws, others };
}
const run = (email: string, extra: Partial<Parameters<typeof seedMine>[1]> = {}) =>
  seedMine(prisma, { email, now: NOW, confirm: yes, ...extra });

describe("seed:mine", () => {
  it("stops with a clear message, and creates nothing, when the account doesn't exist", async () => {
    const before = await prisma.user.count();
    await expect(run("nobody-here@example.test")).rejects.toThrow(
      "Sign in once in the app first so your account exists.",
    );
    expect(await prisma.user.count()).toBe(before);
  });

  it("matches the email case-insensitively", async () => {
    const { me, ws } = await userWithWorkspace("case");
    const r = await run(me.email.toUpperCase());
    expect(r.workspaceSlug).toBe(ws.slug);
    expect(r.incidentsCreated).toBe(16);
  });

  it("seeds services, incidents, links, roles and a timeline into the member's only workspace", async () => {
    const fixture = await loadFixture();
    const { me, ws } = await userWithWorkspace("solo");
    const r = await run(me.email);
    expect(r).toMatchObject({
      cancelled: false,
      workspaceCreated: false,
      servicesCreated: 8,
      incidentsCreated: 16,
      incidentsSkipped: 0,
    });
    expect(r.numbers).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } })).nextIncidentNumber).toBe(17);

    const incidents = await prisma.incident.findMany({
      where: { workspaceId: ws.id },
      include: { services: true, assignments: true, events: true },
      orderBy: { number: "asc" },
    });
    expect(incidents).toHaveLength(16);
    fixture.incidents.forEach((spec, i) => {
      const inc = incidents[i];
      expect(inc).toMatchObject({
        title: spec.title,
        severity: spec.severity,
        status: spec.status,
        createdById: me.id,
      });
      expect(inc.seedKey).toBe(seedKeyOf(spec.title));
      expect(inc.startedAt.getTime()).toBe(NOW.getTime() - spec.startedHoursAgo * 3_600_000);
      if (spec.status === "RESOLVED") {
        expect(inc.resolvedAt!.getTime() - inc.startedAt.getTime()).toBe(spec.durationMinutes! * 60_000);
      } else expect(inc.resolvedAt).toBeNull();
      expect(inc.services).toHaveLength(spec.services.length);

      const notes = inc.events.filter((e) => e.type === "NOTE");
      expect(notes.map((n) => n.body).sort()).toEqual(spec.notes.map((n) => n.body).sort());
      for (const n of notes) expect(n.createdAt.getTime()).toBe(n.occurredAt.getTime()); // nothing "added later"
      const sorted = [...inc.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      expect(sorted[0]).toMatchObject({ type: "STATUS_CHANGED", source: "SYSTEM", payload: { created: true } });
      expect(inc.events.every((e) => e.occurredAt >= inc.startedAt && e.occurredAt <= (inc.resolvedAt ?? NOW))).toBe(
        true,
      );
      const lastStatus = inc.events
        .filter((e) => e.type === "STATUS_CHANGED")
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
        .at(-1)!;
      expect((lastStatus.payload as { to: string }).to).toBe(spec.status);
    });
    // with a single member, every index falls back to me, and a null scribe gets no role
    expect(
      new Set((await prisma.incidentAssignment.findMany({ where: { workspaceId: ws.id } })).map((a) => a.userId)),
    ).toEqual(new Set([me.id]));
    const open = incidents.find((i) => i.title === "Payment webhook failures from provider")!;
    expect(open.assignments.map((a) => a.role)).toEqual(["COMMANDER"]);
    expect(await prisma.auditLog.count({ where: { workspaceId: ws.id, action: "incident.created" } })).toBe(16);
  });

  it("maps the indexes onto real members, me first, and invents nobody", async () => {
    const { me, ws, others } = await userWithWorkspace("team", 2);
    const usersBefore = await prisma.user.count();
    await run(me.email);
    expect(await prisma.user.count()).toBe(usersBefore);
    const first = await prisma.incident.findFirstOrThrow({
      where: { workspaceId: ws.id, number: 1 }, // commander 0, scribe 1
      include: { assignments: true, events: { where: { type: "NOTE" } } },
    });
    const holder = (role: string) => first.assignments.find((a) => a.role === role)!.userId;
    expect(holder("COMMANDER")).toBe(me.id);
    const ordered = (
      await prisma.membership.findMany({
        where: { workspaceId: ws.id, userId: { not: me.id } },
        orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
      })
    ).map((m) => m.userId);
    expect(new Set(ordered)).toEqual(new Set(others.map((o) => o.id)));
    expect(holder("SCRIBE")).toBe(ordered[0]);
    expect(first.events.every((n) => n.actorId === ordered[0])).toBe(true); // notes are written by the scribe
    const third = await prisma.incident.findFirstOrThrow({
      where: { workspaceId: ws.id, number: 3 }, // commander 2 (second other), scribe 0 (me)
      include: { assignments: true },
    });
    expect(third.assignments.find((a) => a.role === "COMMANDER")!.userId).toBe(ordered[1]);
    expect(third.assignments.find((a) => a.role === "SCRIBE")!.userId).toBe(me.id);
  });

  it("creates nothing the second time", async () => {
    const { me, ws } = await userWithWorkspace("twice");
    await run(me.email);
    const counts = async () => ({
      incidents: await prisma.incident.count({ where: { workspaceId: ws.id } }),
      events: await prisma.event.count({ where: { workspaceId: ws.id } }),
      services: await prisma.service.count({ where: { workspaceId: ws.id } }),
      links: await prisma.incidentService.count({ where: { workspaceId: ws.id } }),
      roles: await prisma.incidentAssignment.count({ where: { workspaceId: ws.id } }),
      audits: await prisma.auditLog.count({ where: { workspaceId: ws.id } }),
      next: (await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } })).nextIncidentNumber,
    });
    const before = await counts();
    const again = await run(me.email, { now: new Date(NOW.getTime() + 86_400_000) });
    expect(again).toMatchObject({
      servicesCreated: 0,
      incidentsCreated: 0,
      incidentsSkipped: 16,
      eventsCreated: 0,
      numbers: [],
    });
    expect(await counts()).toEqual(before);
  });

  it("reuses services that already exist, and never resurrects a deleted incident", async () => {
    const { me, ws } = await userWithWorkspace("exist");
    await prisma.service.create({ data: { workspaceId: ws.id, name: "Search", slug: "search" } });
    await prisma.service.create({ data: { workspaceId: ws.id, name: "web app", slug: "webapp-legacy" } }); // same name, other slug
    const r = await run(me.email);
    expect(r.servicesCreated).toBe(6);
    expect(await prisma.service.count({ where: { workspaceId: ws.id } })).toBe(8);

    await prisma.incident.updateMany({ where: { workspaceId: ws.id, number: 2 }, data: { deletedAt: new Date() } });
    const again = await run(me.email);
    expect(again.incidentsCreated).toBe(0);
    expect(await prisma.incident.count({ where: { workspaceId: ws.id } })).toBe(16);
  });

  it("numbers new incidents after the ones already there", async () => {
    const { me, ws } = await userWithWorkspace("numbers");
    await prisma.workspace.update({ where: { id: ws.id }, data: { nextIncidentNumber: 8 } });
    const r = await run(me.email);
    expect(r.numbers[0]).toBe(8);
    expect(r.numbers.at(-1)).toBe(23);
  });

  describe("choosing the workspace", () => {
    it("asks for --workspace when you belong to several, listing them, and writes nothing", async () => {
      const a = await userWithWorkspace("multi");
      const second = await prisma.workspace.create({
        data: { name: "Second", slug: `second-${Math.random().toString(36).slice(2, 8)}` },
      });
      await prisma.membership.create({ data: { workspaceId: second.id, userId: a.me.id, role: "MEMBER" } });
      await expect(run(a.me.email)).rejects.toThrow(/--workspace/);
      await expect(run(a.me.email)).rejects.toThrow(a.ws.slug);
      expect(await prisma.incident.count({ where: { workspaceId: { in: [a.ws.id, second.id] } } })).toBe(0);

      const r = await run(a.me.email, { workspace: second.slug });
      expect(r.workspaceSlug).toBe(second.slug);
      expect(await prisma.incident.count({ where: { workspaceId: second.id } })).toBe(16);
      expect(await prisma.incident.count({ where: { workspaceId: a.ws.id } })).toBe(0);
    });

    it("requires membership of the named workspace", async () => {
      const mine = await userWithWorkspace("mine");
      const theirs = await userWithWorkspace("theirs");
      await expect(run(mine.me.email, { workspace: theirs.ws.slug })).rejects.toBeInstanceOf(SeedMineError);
      await expect(run(mine.me.email, { workspace: "does-not-exist" })).rejects.toThrow(/not a member/);
      expect(await prisma.incident.count({ where: { workspaceId: theirs.ws.id } })).toBe(0);
    });

    it("creates 'The Crypt Demo' with the normal defaults when you have none, but only after you confirm", async () => {
      const me = await createUser("homeless");
      let plan: MinePlan | undefined;
      const declined = await run(me.email, {
        confirm: async (p) => {
          plan = p;
          return false;
        },
      });
      expect(plan).toMatchObject({ workspaceName: "The Crypt Demo", createsWorkspace: true, mode: "seed" });
      expect(declined.cancelled).toBe(true);
      expect(await prisma.membership.count({ where: { userId: me.id } })).toBe(0);

      const r = await run(me.email);
      expect(r).toMatchObject({ workspaceCreated: true, incidentsCreated: 16 });
      const m = await prisma.membership.findFirstOrThrow({
        where: { userId: me.id },
        include: { workspace: { include: { retroRule: true, postmortemTemplates: true } } },
      });
      expect(m.role).toBe("OWNER");
      expect(m.workspace).toMatchObject({ name: "The Crypt Demo", skin: "HAUNTED" });
      expect(m.workspace.retroRule).toMatchObject({ minSeverity: 4, mode: "REQUIRED" });
      expect(m.workspace.postmortemTemplates).toHaveLength(1);
      expect(r.workspaceSlug).toBe(m.workspace.slug);
    });
  });

  it("shows the plan and writes nothing when you decline", async () => {
    const { me, ws } = await userWithWorkspace("decline");
    let plan: MinePlan | undefined;
    const r = await run(me.email, {
      confirm: async (p) => {
        plan = p;
        return false;
      },
    });
    expect(plan).toMatchObject({ workspaceSlug: ws.slug, workspaceName: ws.name, createsWorkspace: false });
    expect(r.cancelled).toBe(true);
    expect(await prisma.incident.count({ where: { workspaceId: ws.id } })).toBe(0);
    expect(await prisma.service.count({ where: { workspaceId: ws.id } })).toBe(0);
  });

  describe("--reset", () => {
    it("deletes only the seeded incidents (with their events, links and roles) and nothing else", async () => {
      const { me, ws } = await userWithWorkspace("reset");
      await run(me.email);

      // things that must survive: a real incident with its own rows, a service, another workspace's seed
      const real = await prisma.incident.create({
        data: {
          workspaceId: ws.id,
          number: 100,
          title: "A real outage",
          severity: 2,
          createdById: me.id,
          assignments: { create: { role: "COMMANDER", userId: me.id } },
        },
      });
      await prisma.event.create({
        data: { workspaceId: ws.id, incidentId: real.id, type: "NOTE", actorId: me.id, body: "mine", occurredAt: NOW },
      });
      const other = await userWithWorkspace("reset-other");
      await run(other.me.email);

      const keptBefore = {
        services: await prisma.service.count({ where: { workspaceId: ws.id } }),
        members: await prisma.membership.count({ where: { workspaceId: ws.id } }),
        otherIncidents: await prisma.incident.count({ where: { workspaceId: other.ws.id } }),
        otherEvents: await prisma.event.count({ where: { workspaceId: other.ws.id } }),
      };

      let plan: MinePlan | undefined;
      const r = await run(me.email, {
        reset: true,
        confirm: async (p) => {
          plan = p;
          return true;
        },
      });
      expect(plan).toMatchObject({ mode: "reset", resetCount: 16, resetKept: 0 });
      expect(r.incidentsDeleted).toBe(16);

      expect(await prisma.incident.findMany({ where: { workspaceId: ws.id }, select: { id: true } })).toEqual([
        { id: real.id },
      ]);
      expect(await prisma.event.count({ where: { workspaceId: ws.id } })).toBe(1);
      expect(await prisma.incidentService.count({ where: { workspaceId: ws.id } })).toBe(0);
      expect(await prisma.incidentAssignment.count({ where: { workspaceId: ws.id } })).toBe(1);
      expect(await prisma.service.count({ where: { workspaceId: ws.id } })).toBe(keptBefore.services);
      expect(await prisma.membership.count({ where: { workspaceId: ws.id } })).toBe(keptBefore.members);
      expect(await prisma.incident.count({ where: { workspaceId: other.ws.id } })).toBe(keptBefore.otherIncidents);
      expect(await prisma.event.count({ where: { workspaceId: other.ws.id } })).toBe(keptBefore.otherEvents);

      // and seeding again brings them back with fresh numbers
      const again = await run(me.email);
      expect(again.incidentsCreated).toBe(16);
      expect(again.numbers[0]).toBeGreaterThan(16);
    });

    it("does nothing without a yes, and keeps seeded incidents that have a postmortem", async () => {
      const { me, ws } = await userWithWorkspace("reset-keep");
      await run(me.email);
      const declined = await run(me.email, { reset: true, confirm: async () => false });
      expect(declined.cancelled).toBe(true);
      expect(await prisma.incident.count({ where: { workspaceId: ws.id } })).toBe(16);

      const withPm = await prisma.incident.findFirstOrThrow({ where: { workspaceId: ws.id, number: 1 } });
      await prisma.postmortem.create({
        data: { workspaceId: ws.id, incidentId: withPm.id, authorId: me.id },
      });
      const r = await run(me.email, { reset: true });
      expect(r).toMatchObject({ incidentsDeleted: 15, incidentsKept: 1 });
      expect(await prisma.incident.findMany({ where: { workspaceId: ws.id }, select: { id: true } })).toEqual([
        { id: withPm.id },
      ]);
      expect(await prisma.postmortem.count({ where: { incidentId: withPm.id } })).toBe(1);
    });

    it("is a quiet no-op when nothing was seeded", async () => {
      const { me } = await userWithWorkspace("reset-empty");
      let asked = false;
      const r = await run(me.email, {
        reset: true,
        confirm: async () => {
          asked = true;
          return true;
        },
      });
      expect(r).toMatchObject({ incidentsDeleted: 0, cancelled: false });
      expect(asked).toBe(false);
    });
  });
});
