import { beforeAll, describe, expect, it } from "vitest";
import { listIncidents } from "@/features/incidents/list";
import { parseListParams } from "@/features/incidents/list-params";
import { listServices } from "@/features/services/service";
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
      templates: 1,
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
      include: { events: { orderBy: { occurredAt: "asc" } } },
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
