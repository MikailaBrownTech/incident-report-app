import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { scopedDb } from "@/server/db/tenant";
import { createTeam } from "@/test/fixtures";
import { getDashboard } from "./queries";

const DAY = 86_400_000;

async function fixture(label: string) {
  const team = await createTeam(label);
  const ws = team.workspace.id;
  const now = new Date();
  let n = 0;
  const incident = (over: {
    daysAgo: number;
    severity?: number;
    open?: boolean;
    deleted?: boolean;
    hours?: number;
  }) => {
    const startedAt = new Date(now.getTime() - over.daysAgo * DAY);
    n += 1;
    return prisma.incident.create({
      data: {
        workspaceId: ws,
        number: n,
        title: `Incident ${n}`,
        severity: over.severity ?? 3,
        status: over.open ? "INVESTIGATING" : "RESOLVED",
        startedAt,
        resolvedAt: over.open ? null : new Date(startedAt.getTime() + (over.hours ?? 2) * 3_600_000),
        createdById: team.owner.id,
        deletedAt: over.deleted ? new Date() : null,
      },
    });
  };
  return { ws, now, incident, db: scopedDb(ws), team };
}

describe("getDashboard", () => {
  it("counts only incidents inside the window, and tells an empty window how many older ones exist", async () => {
    const f = await fixture("dash-window");
    await f.incident({ daysAgo: 2, severity: 5, open: true });
    await f.incident({ daysAgo: 10, severity: 2, hours: 4 });
    await f.incident({ daysAgo: 60, severity: 2, hours: 6 });
    await f.incident({ daysAgo: 5, deleted: true });

    const d30 = await getDashboard(f.db, "30d", f.now);
    expect(d30.inRange).toBe(2);
    expect(d30.olderCount).toBe(1); // the deleted one is invisible, the 60 day old one is not
    expect(d30.totalAll).toBe(3);
    expect(d30.bySeverity).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 });
    expect(d30.openNow).toBe(1);
    expect(d30.mttrMinutes).toBe(240); // only the resolved one in the window
    expect(d30.buckets.reduce((s, b) => s + b.count, 0)).toBe(2);
    expect(d30.needsAttention.map((i) => i.number)).toEqual([1]);

    const d7 = await getDashboard(f.db, "7d", f.now);
    expect(d7.inRange).toBe(1);

    const all = await getDashboard(f.db, "all", f.now);
    expect(all.inRange).toBe(3);
    expect(all.olderCount).toBe(0);
    expect(all.mttrMinutes).toBe(300);
  });

  it("shows an empty window when everything is older than it, never another workspace's incidents", async () => {
    const f = await fixture("dash-old");
    const other = await fixture("dash-other");
    await f.incident({ daysAgo: 120 });
    await other.incident({ daysAgo: 1 });

    const d = await getDashboard(f.db, "30d", f.now);
    expect(d.inRange).toBe(0);
    expect(d.olderCount).toBe(1);
    expect(d.mttrMinutes).toBeNull();
    expect((await getDashboard(f.db, "all", f.now)).inRange).toBe(1);
  });

  it("counts overdue action items, ignoring done ones and soft-deleted incidents", async () => {
    const f = await fixture("dash-overdue");
    const inc = await f.incident({ daysAgo: 20 });
    const gone = await f.incident({ daysAgo: 20 });
    const pm = (incidentId: string) =>
      prisma.postmortem.create({
        data: { workspaceId: f.ws, incidentId, authorId: f.team.owner.id, templateId: "tpl_standard", status: "DRAFT" },
      });
    const [p1, p2] = [await pm(inc.id), await pm(gone.id)];
    const item = (postmortemId: string, incidentId: string, status: "OPEN" | "DONE", day: string, i: number) =>
      prisma.actionItem.create({
        data: {
          workspaceId: f.ws,
          postmortemId,
          incidentId,
          title: `Item ${i}`,
          ownerId: f.team.owner.id,
          createdById: f.team.owner.id,
          status,
          dueDate: new Date(`${day}T00:00:00Z`),
          position: `a${i}`,
        },
      });
    await item(p1.id, inc.id, "OPEN", "2020-01-01", 1);
    await item(p1.id, inc.id, "DONE", "2020-01-01", 2);
    await item(p1.id, inc.id, "OPEN", "2999-01-01", 3);
    await item(p2.id, gone.id, "OPEN", "2020-01-01", 4);
    await prisma.incident.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    expect((await getDashboard(f.db, "30d", f.now)).overdueItems).toBe(1);
  });
});
