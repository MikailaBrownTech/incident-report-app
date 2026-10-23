import { beforeAll, describe, expect, it } from "vitest";
import { listIncidents } from "@/features/incidents/list";
import { isMeaningful, readContent } from "@/features/postmortems/content";
import { BUILT_IN_TEMPLATES } from "@/features/postmortems/sections";
import { getPostmortemStatus } from "@/features/postmortems/status";
import { parseListParams } from "@/features/incidents/list-params";
import { listServices } from "@/features/services/service";
import { listTimeline } from "@/features/timeline/queries";
import { prisma } from "@/server/db/client";
import { scopedDb } from "@/server/db/tenant";
import { createUser } from "@/test/fixtures";
import { DEMO_SLUG, seedDemo } from "./demo";

// All tests share the one "demo" workspace, so they run in order.
const NOW = new Date("2026-06-15T12:00:00Z");
let wsId: string;

const counts = async () => ({
  users: await prisma.user.count({ where: { id: { startsWith: "seed-user-" } } }),
  members: await prisma.membership.count({ where: { workspaceId: wsId } }),
  services: await prisma.service.count({ where: { workspaceId: wsId } }),
  incidents: await prisma.incident.count({ where: { workspaceId: wsId } }),
  links: await prisma.incidentService.count({ where: { workspaceId: wsId } }),
  assignments: await prisma.incidentAssignment.count({ where: { workspaceId: wsId } }),
  events: await prisma.event.count({ where: { workspaceId: wsId } }),
  postmortems: await prisma.postmortem.count({ where: { workspaceId: wsId } }),
  actionItems: await prisma.actionItem.count({ where: { workspaceId: wsId } }),
  audits: await prisma.auditLog.count({ where: { workspaceId: wsId } }),
  workspaces: await prisma.workspace.count({ where: { slug: DEMO_SLUG } }),
  retroRules: await prisma.retroRule.count({ where: { workspaceId: wsId } }),
  templates: await prisma.postmortemTemplate.count({ where: { workspaceId: wsId } }),
});

beforeAll(async () => {
  wsId = (await seedDemo(prisma, { now: NOW })).workspaceId;
});

describe("demo seed", () => {
  it("creates the workspace, people, 8 services and 15 incidents", async () => {
    const c = await counts();
    expect(c).toMatchObject({
      workspaces: 1,
      users: 5,
      members: 5,
      services: 8,
      incidents: 15,
      retroRules: 1,
      templates: 0,
    });
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId } });
    expect(ws).toMatchObject({ slug: "demo", skin: "HAUNTED", nextIncidentNumber: 16 });
    expect((await prisma.membership.findMany({ where: { workspaceId: wsId } })).map((m) => m.role).sort()).toEqual([
      "ADMIN",
      "MEMBER",
      "MEMBER",
      "MEMBER",
      "OWNER",
    ]);
  });

  it("spreads incidents over 90 days across every severity and status, about 5 open", async () => {
    const rows = await prisma.incident.findMany({ where: { workspaceId: wsId } });
    expect(new Set(rows.map((r) => r.severity))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(new Set(rows.map((r) => r.status))).toEqual(
      new Set(["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"]),
    );
    expect(rows.filter((r) => r.status !== "RESOLVED")).toHaveLength(5);

    const ages = rows.map((r) => (NOW.getTime() - r.startedAt.getTime()) / 86_400_000);
    expect(Math.max(...ages)).toBeGreaterThan(80);
    expect(Math.max(...ages)).toBeLessThanOrEqual(90);
    expect(Math.min(...ages)).toBeLessThan(1);
    // spread out, not clustered: some incident in every 30-day third
    for (const [lo, hi] of [
      [0, 30],
      [30, 60],
      [60, 90],
    ])
      expect(ages.some((a) => a >= lo && a < hi)).toBe(true);
    expect(rows.every((r) => r.startedAt <= NOW)).toBe(true);
  });

  it("gives resolved incidents realistic durations and open ones none", async () => {
    const rows = await prisma.incident.findMany({ where: { workspaceId: wsId } });
    for (const r of rows) {
      if (r.status === "RESOLVED") {
        const minutes = (r.resolvedAt!.getTime() - r.startedAt.getTime()) / 60_000;
        expect(minutes, `#${r.number}`).toBeGreaterThanOrEqual(30);
        expect(minutes, `#${r.number}`).toBeLessThanOrEqual(6 * 60);
        expect(r.resolvedAt!.getTime()).toBeLessThanOrEqual(NOW.getTime());
      } else {
        expect(r.resolvedAt, `#${r.number}`).toBeNull();
      }
    }
  });

  it("assigns roles to real members and leaves one incident without a commander", async () => {
    const memberIds = new Set(
      (await prisma.membership.findMany({ where: { workspaceId: wsId } })).map((m) => m.userId),
    );
    const assignments = await prisma.incidentAssignment.findMany({
      where: { workspaceId: wsId },
      include: { incident: true },
    });
    expect(assignments.length).toBeGreaterThan(15);
    expect(assignments.every((a) => memberIds.has(a.userId))).toBe(true);
    const withCommander = new Set(assignments.filter((a) => a.role === "COMMANDER").map((a) => a.incident.number));
    expect([...Array(15)].map((_, i) => i + 1).filter((n) => !withCommander.has(n))).toEqual([15]);
  });

  it("writes event history and an audit row for every incident, in a sensible order", async () => {
    const incidents = await prisma.incident.findMany({
      where: { workspaceId: wsId },
      // postmortem events come after resolution and have their own test below
      include: {
        events: {
          where: {
            type: {
              notIn: [
                "POSTMORTEM_STARTED",
                "POSTMORTEM_PUBLISHED",
                "RITUAL_CREATED",
                "RITUAL_COMPLETED",
                "REVENANT_LINKED",
              ],
            },
          },
          orderBy: { occurredAt: "asc" },
        },
      },
    });
    for (const inc of incidents) {
      const first = inc.events[0];
      expect(first, `#${inc.number}`).toMatchObject({
        type: "STATUS_CHANGED",
        source: "SYSTEM",
        payload: { created: true },
      });
      expect(first.occurredAt.getTime()).toBe(inc.startedAt.getTime());
      const statusEvents = inc.events.filter(
        (e) => e.type === "STATUS_CHANGED" && !(e.payload as { created?: boolean }).created,
      );
      // the last status event matches the incident's current status
      const last = statusEvents.at(-1)?.payload as { to: string } | undefined;
      expect(last?.to ?? "INVESTIGATING", `#${inc.number}`).toBe(inc.status);
      expect(inc.events.every((e) => e.occurredAt >= inc.startedAt && e.occurredAt <= NOW)).toBe(true);
      if (inc.status === "RESOLVED") expect(inc.events.at(-1)!.occurredAt.getTime()).toBe(inc.resolvedAt!.getTime());
    }
    expect(await prisma.auditLog.count({ where: { workspaceId: wsId, action: "incident.created" } })).toBe(15);
    const escalated = await prisma.event.findMany({ where: { workspaceId: wsId, type: "SEVERITY_CHANGED" } });
    expect(escalated.length).toBeGreaterThanOrEqual(1);
  });

  it("gives every incident a timeline of notes written by the seed people, recorded when they happened", async () => {
    const seedPeople = new Set(
      (await prisma.user.findMany({ where: { id: { startsWith: "seed-user-" } } })).map((u) => u.id),
    );
    const incidents = await prisma.incident.findMany({
      where: { workspaceId: wsId },
      include: { events: true },
    });
    for (const inc of incidents) {
      const notes = inc.events.filter((e) => e.type === "NOTE");
      expect(notes.length, `#${inc.number} has notes`).toBeGreaterThanOrEqual(2);
      for (const n of notes) {
        expect(n.source).toBe("USER");
        expect(seedPeople.has(n.actorId!), `#${inc.number} author`).toBe(true);
        expect(n.body!.length).toBeGreaterThan(10);
        expect(n.occurredAt >= inc.startedAt && n.occurredAt <= (inc.resolvedAt ?? NOW)).toBe(true);
        expect(n.updatedAt.getTime()).toBe(n.createdAt.getTime());
      }
      // the automatic entries make the incident's own history readable too
      expect(inc.events.some((e) => e.type === "STATUS_CHANGED")).toBe(true);
    }
  });

  it("marks one key moment on each of two resolved incidents and nowhere else", async () => {
    const keys = await prisma.event.findMany({
      where: { workspaceId: wsId, isKeyMoment: true },
      include: { incident: true },
    });
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.incident.number).sort((a, b) => a - b)).toEqual([3, 6]);
    for (const k of keys) {
      expect(k.incident.status).toBe("RESOLVED");
      expect(k.type).toBe("NOTE");
    }
  });

  it("includes one backfilled note, recorded well after it happened, and no other entry looks late", async () => {
    const events = await prisma.event.findMany({ where: { workspaceId: wsId }, include: { incident: true } });
    const late = events.filter((e) => e.createdAt.getTime() - e.occurredAt.getTime() > 2 * 60_000);
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ type: "NOTE", incident: { number: 10 } });
    expect(late[0].createdAt <= NOW).toBe(true);
  });

  it("shows the timeline through the app's own query, oldest to newest with ties broken by id", async () => {
    const db = scopedDb(wsId);
    const inc = await prisma.incident.findFirstOrThrow({ where: { workspaceId: wsId, number: 3 } });
    const asc = await listTimeline(db, inc.id, { filter: "all", order: "asc", limit: 100 });
    const times = asc.items.map((e) => e.occurredAt);
    expect([...times].sort()).toEqual(times);
    expect(asc.items.filter((e) => e.isKeyMoment)).toHaveLength(1);
    const keyOnly = await listTimeline(db, inc.id, { filter: "key", order: "asc", limit: 100 });
    expect(keyOnly.items.map((e) => e.body)).toEqual(["Rolled back release 4812."]);
  });

  it("has two published postmortems, one draft, and an overdue incident with none", async () => {
    const pms = await prisma.postmortem.findMany({ where: { workspaceId: wsId }, include: { incident: true } });
    expect(pms.map((p) => `${p.incident.number}:${p.status}`).sort()).toEqual([
      "3:PUBLISHED",
      "5:DRAFT",
      "6:PUBLISHED",
    ]);
    for (const pm of pms.filter((p) => p.status === "PUBLISHED")) {
      expect(pm.publishedAt).not.toBeNull();
      expect(pm.publishedById).not.toBeNull();
      expect(await prisma.event.count({ where: { incidentId: pm.incidentId, type: "POSTMORTEM_PUBLISHED" } })).toBe(1);
      const template = BUILT_IN_TEMPLATES.find((t) => t.id === pm.templateId)!;
      const content = readContent(pm.content);
      for (const s of template.sections.filter((x) => x.required))
        expect(isMeaningful(content.sections[s.key]), s.key).toBe(true);
    }
    const rules = await prisma.retroRule.findMany({ where: { workspaceId: wsId } });
    const ten = await prisma.incident.findFirstOrThrow({
      where: { workspaceId: wsId, number: 10 },
      include: { postmortem: true },
    });
    expect(getPostmortemStatus(ten, rules, ten.postmortem, NOW).state).toBe("OVERDUE"); // severity 4, resolved, none
  });

  it("has a few action items on the postmortems, owned by real members", async () => {
    const items = await prisma.actionItem.findMany({ where: { workspaceId: wsId }, include: { incident: true } });
    expect(items).toHaveLength(7);
    expect(new Set(items.map((i) => i.incident.number))).toEqual(new Set([3, 5, 6]));
    const members = new Set((await prisma.membership.findMany({ where: { workspaceId: wsId } })).map((m) => m.userId));
    expect(items.every((i) => members.has(i.ownerId))).toBe(true);
    expect(items.filter((i) => i.status === "WONT_DO").every((i) => i.wontDoReason)).toBe(true);
  });

  it("links the repeat incidents to their roots and leaves the search pair unlinked", async () => {
    const rows = await prisma.incident.findMany({
      where: { workspaceId: wsId },
      select: { number: true, revenantOfId: true },
    });
    const idOf = Object.fromEntries(
      (await prisma.incident.findMany({ where: { workspaceId: wsId } })).map((i) => [i.number, i.id]),
    );
    const rootOf = Object.fromEntries(rows.map((r) => [r.number, r.revenantOfId]));
    expect(rootOf[8]).toBe(idOf[3]);
    expect(rootOf[10]).toBe(idOf[5]);
    expect(rootOf[15]).toBe(idOf[5]);
    for (const n of [2, 11, 3, 5]) expect(rootOf[n], `#${n} stays a root or standalone`).toBeNull();
    expect(await prisma.event.count({ where: { workspaceId: wsId, type: "REVENANT_LINKED" } })).toBe(6);
  });

  it("includes look-alike titles that trigram matching actually pairs up", async () => {
    const title = async (n: number) =>
      (await prisma.incident.findFirstOrThrow({ where: { workspaceId: wsId, number: n } })).title;
    const sim = async (x: number, y: number) => {
      const [tx, ty] = [await title(x), await title(y)];
      const rows = await prisma.$queryRaw<{ s: number }[]>`select public.similarity(${tx}::text, ${ty}::text) as s`;
      return Number(rows[0].s);
    };
    expect(await sim(3, 8)).toBeGreaterThan(0.4); // Checkout API timeouts / timeout spike
    expect(await sim(5, 10)).toBeGreaterThan(0.4); // Payment webhook failures / delivery failures
    expect(await sim(5, 15)).toBeGreaterThan(0.4); // ... and "again"
    expect(await sim(3, 5)).toBeLessThan(0.3); // unrelated incidents don't pair up
  });

  it("shows up correctly through the scoped client the app uses", async () => {
    const db = scopedDb(wsId);
    const open = await listIncidents(db, parseListParams({}));
    expect(open.items.map((i) => i.number).sort((a, b) => a - b)).toEqual([11, 12, 13, 14, 15]);
    const all = await listIncidents(db, parseListParams({ open: "0", limit: "100" }));
    expect(all.items).toHaveLength(15);
    const checkout = await listIncidents(db, parseListParams({ q: "checkout", open: "0" }));
    expect(checkout.items.map((i) => i.number).sort((a, b) => a - b)).toEqual([3, 8, 13]);

    const services = await listServices(db);
    expect(services).toHaveLength(8);
    const checkoutSvc = services.find((s) => s.name === "Checkout API")!;
    expect(checkoutSvc).toMatchObject({ slug: "checkout-api", totalIncidents: 4, openIncidents: 1 });
    expect(all.items.find((i) => i.number === 13)!.services).toHaveLength(4); // exercises the "+N" display
  });
});

describe("running it again", () => {
  it("duplicates nothing and says everything was already there", async () => {
    const before = await counts();
    const again = await seedDemo(prisma, { now: new Date(NOW.getTime() + 3 * 86_400_000) });
    const twice = await seedDemo(prisma, { now: new Date(NOW.getTime() + 9 * 86_400_000) });
    expect(again).toMatchObject({ workspaceId: wsId, createdIncidents: 0, skippedIncidents: 15 });
    expect(twice).toMatchObject({ createdIncidents: 0, skippedIncidents: 15 });
    expect(await counts()).toEqual(before);
  });

  it("leaves existing incidents untouched, even their dates", async () => {
    const snapshot = JSON.stringify(
      await prisma.incident.findMany({ where: { workspaceId: wsId }, orderBy: { number: "asc" } }),
    );
    await seedDemo(prisma, { now: new Date(NOW.getTime() + 30 * 86_400_000) });
    expect(
      JSON.stringify(await prisma.incident.findMany({ where: { workspaceId: wsId }, orderBy: { number: "asc" } })),
    ).toBe(snapshot);
  });

  it("never overwrites edits or resurrects deleted incidents", async () => {
    await prisma.incident.updateMany({
      where: { workspaceId: wsId, number: 3 },
      data: { title: "Renamed by a human" },
    });
    await prisma.incident.updateMany({ where: { workspaceId: wsId, number: 4 }, data: { deletedAt: new Date() } });
    await prisma.workspace.update({ where: { id: wsId }, data: { nextIncidentNumber: 40 } });

    const result = await seedDemo(prisma, { now: NOW });
    expect(result.createdIncidents).toBe(0);
    expect((await prisma.incident.findFirstOrThrow({ where: { workspaceId: wsId, number: 3 } })).title).toBe(
      "Renamed by a human",
    );
    expect(
      (await prisma.incident.findFirstOrThrow({ where: { workspaceId: wsId, number: 4 } })).deletedAt,
    ).not.toBeNull();
    expect(await prisma.incident.count({ where: { workspaceId: wsId } })).toBe(15);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: wsId } })).nextIncidentNumber).toBe(40); // never lowered
  });

  it("fills in only what's missing", async () => {
    await prisma.incident.deleteMany({ where: { workspaceId: wsId, number: 9 } }); // hard delete one
    await prisma.service.deleteMany({ where: { workspaceId: wsId, slug: "notifications" } });
    const result = await seedDemo(prisma, { now: NOW });
    expect(result).toMatchObject({ createdIncidents: 1, skippedIncidents: 14 });
    expect(await prisma.incident.count({ where: { workspaceId: wsId } })).toBe(15);
    expect(await prisma.service.count({ where: { workspaceId: wsId } })).toBe(8);
  });
});

describe("older seeded timelines", () => {
  const marker = (payload: unknown) => (payload as { seedVersion?: number } | null)?.seedVersion;

  it("are rebuilt once, to the current shape, when only seed people touched them", async () => {
    const inc = await prisma.incident.findFirstOrThrow({ where: { workspaceId: wsId, number: 8 } });
    // what the previous seed wrote: no marker, and every entry recorded at seed time
    await prisma.event.updateMany({ where: { incidentId: inc.id }, data: { createdAt: NOW } });
    const first = await prisma.event.findFirstOrThrow({
      where: { incidentId: inc.id, type: "STATUS_CHANGED" },
      orderBy: { occurredAt: "asc" },
    });
    await prisma.event.update({ where: { id: first.id }, data: { payload: { to: "INVESTIGATING", created: true } } });

    const before = await counts();
    const result = await seedDemo(prisma, { now: NOW });
    expect(result.createdIncidents).toBe(0);
    expect(await counts()).toEqual(before); // same number of events, nothing duplicated

    const events = await prisma.event.findMany({ where: { incidentId: inc.id }, orderBy: { occurredAt: "asc" } });
    expect(marker(events[0].payload)).toBe(2);
    expect(events.every((e) => e.createdAt.getTime() === e.occurredAt.getTime())).toBe(true);

    // and now that it is current it is left alone
    const ids = events.map((e) => e.id);
    await seedDemo(prisma, { now: NOW });
    expect(
      (await prisma.event.findMany({ where: { incidentId: inc.id }, orderBy: { occurredAt: "asc" } })).map((e) => e.id),
    ).toEqual(ids);
    expect(marker(events[0].payload)).toBe(2);
  });

  it("are left alone when a real person has added to them", async () => {
    const inc = await prisma.incident.findFirstOrThrow({ where: { workspaceId: wsId, number: 9 } });
    const human = await createUser("writer");
    const first = await prisma.event.findFirstOrThrow({
      where: { incidentId: inc.id, type: "STATUS_CHANGED" },
      orderBy: { occurredAt: "asc" },
    });
    await prisma.event.update({ where: { id: first.id }, data: { payload: { to: "INVESTIGATING", created: true } } });
    await prisma.event.create({
      data: {
        workspaceId: wsId,
        incidentId: inc.id,
        type: "NOTE",
        actorId: human.id,
        body: "written by a real person",
        occurredAt: new Date(inc.startedAt.getTime() + 60_000),
      },
    });
    await seedDemo(prisma, { now: NOW });
    expect(await prisma.event.count({ where: { incidentId: inc.id, body: "written by a real person" } })).toBe(1);
  });
});

describe("SEED_OWNER_EMAIL", () => {
  it("adds your own account as owner, once, and ignores unknown addresses", async () => {
    const me = await createUser("me");
    const original = process.env.SEED_OWNER_EMAIL;
    try {
      process.env.SEED_OWNER_EMAIL = me.email.toUpperCase();
      await seedDemo(prisma, { now: NOW });
      await seedDemo(prisma, { now: NOW });
      const rows = await prisma.membership.findMany({ where: { workspaceId: wsId, userId: me.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("OWNER");

      process.env.SEED_OWNER_EMAIL = "nobody@nowhere.example";
      await expect(seedDemo(prisma, { now: NOW })).resolves.toBeTruthy();
    } finally {
      if (original === undefined) delete process.env.SEED_OWNER_EMAIL;
      else process.env.SEED_OWNER_EMAIL = original;
    }
  });
});
