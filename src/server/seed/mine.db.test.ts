import { describe, expect, it } from "vitest";
import { docText, isMeaningful, readContent, validateContent } from "@/features/postmortems/content";
import { BUILT_IN_TEMPLATES } from "@/features/postmortems/sections";
import { getPostmortemStatus } from "@/features/postmortems/status";
import { prisma } from "@/server/db/client";
import { createUser } from "@/test/fixtures";
import { DUE_SOON_KEY } from "./mine-postmortems";
import { loadFixture, SeedMineError, seedKeyOf, seedMine, type MinePlan } from "./mine";

const NOW = new Date("2026-06-15T12:00:00Z");
const yes = async () => true;

async function userWithWorkspace(name: string, members = 0) {
  const me = await createUser(name);
  const ws = await prisma.workspace.create({
    data: {
      name: `${name} ws`,
      slug: `${name}-${Math.random().toString(36).slice(2, 8)}`,
      retroRules: { create: {} },
    },
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
      postmortemsCreated: 4,
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
      // (the one incident shown as "due soon" is moved to resolve four days ago; it has its own test)
      if (inc.seedKey !== DUE_SOON_KEY) {
        expect(inc.startedAt.getTime()).toBe(NOW.getTime() - spec.startedHoursAgo * 3_600_000);
      }
      if (spec.status === "RESOLVED") {
        expect(inc.resolvedAt!.getTime() - inc.startedAt.getTime()).toBe(spec.durationMinutes! * 60_000);
      } else expect(inc.resolvedAt).toBeNull();
      expect(inc.services).toHaveLength(spec.services.length);

      const notes = inc.events.filter((e) => e.type === "NOTE");
      expect(notes.map((n) => n.body).sort()).toEqual(spec.notes.map((n) => n.body).sort());
      for (const n of notes) expect(n.createdAt.getTime()).toBe(n.occurredAt.getTime()); // nothing "added later"
      const sorted = [...inc.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      expect(sorted[0]).toMatchObject({ type: "STATUS_CHANGED", source: "SYSTEM", payload: { created: true } });
      // (postmortem events come after the incident is resolved, so they are checked in their own test)
      expect(
        inc.events
          .filter((e) => !e.type.startsWith("POSTMORTEM_"))
          .every((e) => e.occurredAt >= inc.startedAt && e.occurredAt <= (inc.resolvedAt ?? NOW)),
      ).toBe(true);
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
      postmortems: await prisma.postmortem.count({ where: { workspaceId: ws.id } }),
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
      postmortemsCreated: 0,
      numbers: [],
    });
    expect(await counts()).toEqual(before);
    expect(before.postmortems).toBe(4);
  });

  it("seeds postmortems: two published, two drafts, two overdue, one due soon", async () => {
    const { me, ws } = await userWithWorkspace("pm-seed");
    await run(me.email);
    const rules = await prisma.retroRule.findMany({ where: { workspaceId: ws.id } });
    const incidents = await prisma.incident.findMany({
      where: { workspaceId: ws.id },
      include: {
        postmortem: true,
        events: { where: { type: { in: ["POSTMORTEM_STARTED", "POSTMORTEM_PUBLISHED"] } } },
      },
    });
    const state = (title: string) => {
      const i = incidents.find((x) => x.title === title)!;
      return getPostmortemStatus(i, rules, i.postmortem, NOW).state;
    };
    expect(state("Database primary failover")).toBe("PUBLISHED");
    expect(state("Checkout API timeouts during flash sale")).toBe("PUBLISHED");
    expect(state("Payment webhook failures")).toBe("DRAFT");
    expect(state("Search index lag after reindex")).toBe("DRAFT");
    expect(state("Login failures for SSO users")).toBe("OVERDUE");
    expect(state("Checkout API timeout spike")).toBe("OVERDUE");
    expect(state("Web app blank page after deploy")).toBe("DUE_SOON");

    // the incident whose resolution was adjusted still has a sensible shape
    const blank = incidents.find((x) => x.title === "Web app blank page after deploy")!;
    expect(blank.resolvedAt!.getTime()).toBe(NOW.getTime() - 4 * 86_400_000);
    expect(blank.resolvedAt!.getTime() - blank.startedAt.getTime()).toBe(35 * 60_000);
    expect(blank.postmortem).toBeNull();

    // everything else resolved at severity 4+ without a postmortem is exactly those three
    const needing = incidents
      .filter((i) => i.severity >= 4 && i.status === "RESOLVED" && !i.postmortem)
      .map((i) => i.title)
      .sort();
    expect(needing).toEqual([
      "Checkout API timeout spike",
      "Login failures for SSO users",
      "Web app blank page after deploy",
    ]);
  });

  it("writes believable postmortems: published ones are complete, drafts are partly filled, events are in order", async () => {
    const { me, ws } = await userWithWorkspace("pm-content");
    await run(me.email);
    const pms = await prisma.postmortem.findMany({
      where: { workspaceId: ws.id },
      include: { incident: { include: { events: true } } },
    });
    expect(pms).toHaveLength(4);
    for (const pm of pms) {
      const template = BUILT_IN_TEMPLATES.find((t) => t.id === pm.templateId)!;
      const content = readContent(pm.content);
      expect(Object.keys(content.sections).every((k) => template.sections.some((s) => s.key === k))).toBe(true);
      expect(
        validateContent(
          content.sections,
          template.sections.map((s) => s.key),
        ).ok,
      ).toBe(true);
      const required = template.sections.filter((s) => s.required).map((s) => s.key);
      const filled = required.filter((k) => isMeaningful(content.sections[k]));
      if (pm.status === "PUBLISHED") {
        expect(filled).toEqual(required); // could be published as it stands
        expect(pm.publishedAt).not.toBeNull();
        expect(pm.publishedAt! > pm.incident.resolvedAt!).toBe(true);
        expect(pm.publishedAt! <= NOW).toBe(true);
        expect(pm.publishedById).not.toBeNull();
        const events = pm.incident.events.filter((e) => e.type.startsWith("POSTMORTEM_"));
        expect(events.map((e) => e.type).sort()).toEqual(["POSTMORTEM_PUBLISHED", "POSTMORTEM_STARTED"]);
        expect(
          await prisma.auditLog.count({
            where: { workspaceId: ws.id, action: "postmortem.published", targetId: pm.id },
          }),
        ).toBe(1);
      } else {
        expect(filled.length).toBeGreaterThan(0);
        expect(filled.length).toBeLessThan(required.length); // partly filled
        expect(pm.publishedAt).toBeNull();
        expect(pm.incident.events.filter((e) => e.type === "POSTMORTEM_STARTED")).toHaveLength(1);
      }
    }
    // the root cause comes from the fixture
    const failover = pms.find((p) => p.incident.title === "Database primary failover")!;
    expect(docText(readContent(failover.content).sections.root_cause)).toContain("Hardware fault on the primary node");
    // standard published ones carry a timeline built from the incident's notes
    expect(docText(readContent(failover.content).sections.timeline)).toContain("Failover triggered automatically");
  });

  it("adds postmortems to an account that was seeded before they existed, without touching anything else", async () => {
    const { me, ws } = await userWithWorkspace("pm-late");
    await run(me.email);
    const incidentsBefore = JSON.stringify(
      await prisma.incident.findMany({ where: { workspaceId: ws.id }, orderBy: { number: "asc" } }),
    );
    await prisma.postmortem.deleteMany({ where: { workspaceId: ws.id } });
    const r = await run(me.email);
    expect(r).toMatchObject({ incidentsCreated: 0, incidentsSkipped: 16, postmortemsCreated: 4 });
    expect(
      JSON.stringify(await prisma.incident.findMany({ where: { workspaceId: ws.id }, orderBy: { number: "asc" } })),
    ).toBe(incidentsBefore);
  });

  it("never overwrites a postmortem someone has edited", async () => {
    const { me, ws } = await userWithWorkspace("pm-edited");
    await run(me.email);
    const pm = await prisma.postmortem.findFirstOrThrow({ where: { workspaceId: ws.id, status: "DRAFT" } });
    await prisma.postmortem.update({ where: { id: pm.id }, data: { content: { sections: {} }, version: 9 } });
    await run(me.email);
    const after = await prisma.postmortem.findUniqueOrThrow({ where: { id: pm.id } });
    expect(after.version).toBe(9);
    expect(after.content).toEqual({ sections: {} });
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
        include: { workspace: { include: { retroRules: true, postmortemTemplates: true } } },
      });
      expect(m.role).toBe("OWNER");
      expect(m.workspace).toMatchObject({ name: "The Crypt Demo", skin: "HAUNTED" });
      expect(m.workspace.retroRules).toEqual([
        expect.objectContaining({ minSeverity: 4, mode: "REQUIRED", dueInDays: 5 }),
      ]);
      expect(m.workspace.postmortemTemplates).toHaveLength(0);
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
      // the four seeded incidents that have a postmortem are kept; the other twelve go
      expect(plan).toMatchObject({ mode: "reset", resetCount: 12, resetKept: 4 });
      expect(r).toMatchObject({ incidentsDeleted: 12, incidentsKept: 4 });

      const remaining = await prisma.incident.findMany({
        where: { workspaceId: ws.id },
        select: { id: true, seedKey: true, postmortem: { select: { id: true } } },
      });
      expect(remaining.filter((i) => i.seedKey === null).map((i) => i.id)).toEqual([real.id]);
      const seededLeft = remaining.filter((i) => i.seedKey !== null);
      expect(seededLeft).toHaveLength(4);
      expect(seededLeft.every((i) => i.postmortem)).toBe(true); // exactly the ones with postmortems
      const keptIds = remaining.map((i) => i.id);
      expect(
        await prisma.incidentService.count({ where: { workspaceId: ws.id, incidentId: { notIn: keptIds } } }),
      ).toBe(0);
      expect(await prisma.event.count({ where: { workspaceId: ws.id, incidentId: { notIn: keptIds } } })).toBe(0);
      expect(await prisma.event.count({ where: { incidentId: real.id } })).toBe(1);
      expect(await prisma.incidentAssignment.count({ where: { incidentId: real.id } })).toBe(1);
      expect(await prisma.postmortem.count({ where: { workspaceId: ws.id } })).toBe(4);
      expect(await prisma.service.count({ where: { workspaceId: ws.id } })).toBe(keptBefore.services);
      expect(await prisma.membership.count({ where: { workspaceId: ws.id } })).toBe(keptBefore.members);
      expect(await prisma.incident.count({ where: { workspaceId: other.ws.id } })).toBe(keptBefore.otherIncidents);
      expect(await prisma.event.count({ where: { workspaceId: other.ws.id } })).toBe(keptBefore.otherEvents);

      // and seeding again brings the twelve back with fresh numbers (the four kept ones are skipped, not duplicated)
      const again = await run(me.email);
      expect(again).toMatchObject({ incidentsCreated: 12, incidentsSkipped: 4, postmortemsCreated: 0 });
      expect(again.numbers[0]).toBeGreaterThan(16);
    });

    it("does nothing without a yes, and keeps seeded incidents that have a postmortem", async () => {
      const { me, ws } = await userWithWorkspace("reset-keep");
      await run(me.email);
      const declined = await run(me.email, { reset: true, confirm: async () => false });
      expect(declined.cancelled).toBe(true);
      expect(await prisma.incident.count({ where: { workspaceId: ws.id } })).toBe(16);

      // somebody writes a postmortem for one that had none ("Login failures for SSO users")
      const sso = await prisma.incident.findFirstOrThrow({
        where: { workspaceId: ws.id, title: "Login failures for SSO users" },
      });
      await prisma.postmortem.create({
        data: { workspaceId: ws.id, incidentId: sso.id, authorId: me.id, templateId: "tpl_standard" },
      });
      const before = await prisma.postmortem.findMany({ where: { workspaceId: ws.id }, orderBy: { id: "asc" } });
      const r = await run(me.email, { reset: true });
      expect(r).toMatchObject({ incidentsDeleted: 11, incidentsKept: 5 });
      expect(await prisma.incident.count({ where: { workspaceId: ws.id } })).toBe(5);
      expect(await prisma.postmortem.findMany({ where: { workspaceId: ws.id }, orderBy: { id: "asc" } })).toEqual(
        before,
      );
      expect(await prisma.postmortem.count({ where: { incidentId: sso.id } })).toBe(1);
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
