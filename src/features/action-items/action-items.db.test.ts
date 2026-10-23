import { beforeAll, describe, expect, it, vi } from "vitest";
import * as boardRoute from "@/app/api/w/[slug]/action-items/board/route";
import * as itemRoute from "@/app/api/w/[slug]/action-items/[id]/route";
import * as listRoute from "@/app/api/w/[slug]/action-items/route";
import * as createRoute from "@/app/api/w/[slug]/incidents/[number]/action-items/route";
import { prisma } from "@/server/db/client";
import { scopedDb } from "@/server/db/tenant";
import { call, type TestUser } from "@/test/api";
import { addMember, createTeam } from "@/test/fixtures";
import { byPosition } from "./order";
import { addDays, utcDay } from "./state";
import { countMyOverdue, progressBy } from "./service";

vi.mock("@/server/auth/session", async () => {
  const { currentTestUser } = await import("@/test/api");
  return { getSession: async () => (currentTestUser() ? { user: currentTestUser(), session: {} } : null) };
});

const TODAY = utcDay(new Date());
const day = (n: number) => addDays(TODAY, n);
const dayDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
const DAY = 86_400_000;

// ---- helpers -----------------------------------------------------------------------------------------------------
const create = (u: TestUser, slug: string, n: number, body: unknown) =>
  call(u, createRoute.POST, `/api/w/${slug}/incidents/${n}/action-items`, {
    method: "POST",
    body,
    params: { slug, number: String(n) },
  });
const patch = (u: TestUser, slug: string, id: string, body: unknown) =>
  call(u, itemRoute.PATCH, `/api/w/${slug}/action-items/${id}`, { method: "PATCH", body, params: { slug, id } });
const remove = (u: TestUser, slug: string, id: string) =>
  call(u, itemRoute.DELETE, `/api/w/${slug}/action-items/${id}`, { method: "DELETE", params: { slug, id } });
const one = (u: TestUser, slug: string, id: string) =>
  call(u, itemRoute.GET, `/api/w/${slug}/action-items/${id}`, { params: { slug, id } });
const list = (u: TestUser, slug: string, q = "") =>
  call(u, listRoute.GET, `/api/w/${slug}/action-items${q ? `?${q}` : ""}`, { params: { slug } });
const board = (u: TestUser, slug: string, q = "") =>
  call(u, boardRoute.GET, `/api/w/${slug}/action-items/board${q ? `?${q}` : ""}`, { params: { slug } });

type World = Awaited<ReturnType<typeof world>>;
let w: World;

async function incidentWithPostmortem(
  workspaceId: string,
  createdById: string,
  number: number,
  status: "DRAFT" | "PUBLISHED" = "DRAFT",
) {
  const incident = await prisma.incident.create({
    data: {
      workspaceId,
      number,
      title: `Incident ${number}`,
      severity: 4,
      status: "RESOLVED",
      resolvedAt: new Date(),
      createdById,
    },
  });
  const postmortem = await prisma.postmortem.create({
    data: {
      workspaceId,
      incidentId: incident.id,
      templateId: "tpl_standard",
      authorId: createdById,
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
  });
  return { incident, postmortem };
}

async function world() {
  const a = await createTeam("ai-a");
  const admin = await addMember(a.workspace.id, "ADMIN");
  const m1 = await addMember(a.workspace.id, "MEMBER");
  const m2 = await addMember(a.workspace.id, "MEMBER");
  const b = await createTeam("ai-b");
  const outsider = await addMember(b.workspace.id, "MEMBER");
  const ws = a.workspace.id;
  const inc = {
    draft: await incidentWithPostmortem(ws, a.owner.id, 1),
    published: await incidentWithPostmortem(ws, a.owner.id, 2, "PUBLISHED"),
    second: await incidentWithPostmortem(ws, a.owner.id, 3),
    deleted: await incidentWithPostmortem(ws, a.owner.id, 4),
  };
  const none = await prisma.incident.create({
    data: { workspaceId: ws, number: 5, title: "No postmortem", severity: 2, createdById: a.owner.id },
  });
  const bInc = await incidentWithPostmortem(b.workspace.id, b.owner.id, 1);
  return { a, b, admin, m1, m2, outsider, inc, none, bInc, slug: a.workspace.slug, bSlug: b.workspace.slug, ws };
}

/** Insert directly, for tests about reading and ordering. */
async function seed(over: Record<string, unknown> & { number?: number } = {}) {
  const target =
    over.number === 2
      ? w.inc.published
      : over.number === 3
        ? w.inc.second
        : over.number === 4
          ? w.inc.deleted
          : w.inc.draft;
  const rest = { ...over };
  delete rest.number;
  return prisma.actionItem.create({
    data: {
      workspaceId: w.ws,
      postmortemId: target.postmortem.id,
      incidentId: target.incident.id,
      title: "Seeded item",
      ownerId: w.m1.id,
      createdById: w.a.owner.id,
      ...rest,
    } as never,
  });
}

beforeAll(async () => {
  w = await world();
});

describe("isolation", () => {
  it("answers 404 to non-members on every route, and 401 when signed out", async () => {
    const mine = (await create(w.m1, w.slug, 1, { title: "Isolation check" })).body.items[0];
    const o = w.outsider;
    const statuses = [
      (await create(o, w.slug, 1, { title: "x" })).status,
      (await patch(o, w.slug, mine.id, { title: "y" })).status,
      (await remove(o, w.slug, mine.id)).status,
      (await one(o, w.slug, mine.id)).status,
      (await list(o, w.slug)).status,
      (await board(o, w.slug)).status,
    ];
    expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
    expect((await list(null, w.slug)).status).toBe(401);
    expect((await board(null, w.slug)).status).toBe(401);
  });

  it("never lets workspace A read, edit, move or delete workspace B's items", async () => {
    const theirs = (await create(w.b.owner, w.bSlug, 1, { title: "B's item" })).body.items[0];
    // A's owner, through A's own slug, can't see it, however the id is used
    expect((await one(w.a.owner, w.slug, theirs.id)).status).toBe(404);
    expect((await patch(w.a.owner, w.slug, theirs.id, { title: "hijacked" })).status).toBe(404);
    expect((await patch(w.a.owner, w.slug, theirs.id, { status: "DONE", afterId: null })).status).toBe(404);
    expect((await remove(w.a.owner, w.slug, theirs.id)).status).toBe(404);
    expect((await list(w.a.owner, w.slug)).body.items.map((i: { id: string }) => i.id)).not.toContain(theirs.id);
    expect(
      (await board(w.a.owner, w.slug)).body.columns.flatMap((c: { items: { id: string }[] }) =>
        c.items.map((i) => i.id),
      ),
    ).not.toContain(theirs.id);
    // and B's item is untouched
    expect(await prisma.actionItem.findUnique({ where: { id: theirs.id } })).toMatchObject({
      title: "B's item",
      status: "OPEN",
    });
  });

  it("won't create an item on another workspace's incident, or give it to another workspace's user", async () => {
    expect((await create(w.a.owner, w.slug, 99, { title: "x" })).status).toBe(404);
    const res = await create(w.a.owner, w.slug, 1, { title: "bad owner", ownerId: w.outsider.id });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.ownerId).toEqual(["not_a_member"]);
  });
});

describe("creating", () => {
  it("is refused, with a clear message, when the incident has no postmortem", async () => {
    const res = await create(w.m1, w.slug, 5, { title: "Orphan" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("no_postmortem");
    expect(res.body.error.message).toMatch(/start the autopsy first/i);
    expect(await prisma.actionItem.count({ where: { incidentId: w.none.id } })).toBe(0);
  });

  it("works on a draft and on a published postmortem, for any member", async () => {
    const draft = await create(w.m2, w.slug, 1, { title: "On a draft", dueDate: day(5), description: "Details here" });
    expect(draft.status).toBe(201);
    expect(draft.body.items[0]).toMatchObject({
      title: "On a draft",
      status: "OPEN",
      dueDate: day(5),
      description: "Details here",
      incident: { number: 1 },
    });
    const published = await create(w.m2, w.slug, 2, { title: "After publishing" });
    expect(published.status).toBe(201);
  });

  it("defaults the owner to the creator, and accepts any member as owner", async () => {
    expect((await create(w.m1, w.slug, 1, { title: "Mine by default" })).body.items[0]).toMatchObject({
      ownerId: w.m1.id,
      createdById: w.m1.id,
    });
    const assigned = (await create(w.m1, w.slug, 1, { title: "For admin", ownerId: w.admin.id })).body.items[0];
    expect(assigned).toMatchObject({ ownerId: w.admin.id, createdById: w.m1.id });
    expect(assigned.dueDate).toBeNull(); // no date is fine
  });

  it("puts new items at the end of the Open column", async () => {
    const a = (await create(w.m1, w.slug, 1, { title: "order a" })).body.items[0];
    const b = (await create(w.m1, w.slug, 1, { title: "order b" })).body.items[0];
    expect(a.position < b.position).toBe(true);
  });

  it("validates the body", async () => {
    for (const body of [
      {},
      { title: "" },
      { title: "   " },
      { title: "x".repeat(201) },
      { title: "ok", dueDate: "2026-02-30" },
      { title: "ok", dueDate: "soon" },
      { title: "ok", description: "x".repeat(5001) },
    ]) {
      const res = await create(w.m1, w.slug, 1, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await create(w.m1, w.slug, 1, { title: "x".repeat(200) })).status).toBe(201);
  });

  it("writes exactly one timeline event, and editing writes none", async () => {
    const before = await prisma.event.count({
      where: { incidentId: w.inc.second.incident.id, type: "RITUAL_CREATED" },
    });
    const item = (await create(w.m1, w.slug, 3, { title: "Event check" })).body.items[0];
    const events = await prisma.event.findMany({
      where: { incidentId: w.inc.second.incident.id, type: "RITUAL_CREATED" },
    });
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toMatchObject({
      actorId: w.m1.id,
      source: "USER",
      payload: { actionItemId: item.id, title: "Event check" },
    });
    // edits, reassignments and moves between columns add nothing
    await patch(w.m1, w.slug, item.id, { title: "Renamed", dueDate: day(2), description: "More" });
    await patch(w.admin, w.slug, item.id, { ownerId: w.m2.id });
    await patch(w.m2, w.slug, item.id, { status: "IN_PROGRESS" });
    expect(
      await prisma.event.count({
        where: { incidentId: w.inc.second.incident.id, type: { in: ["RITUAL_CREATED", "RITUAL_COMPLETED"] } },
      }),
    ).toBe(before + 1);
  });
});

describe("permissions", () => {
  it("lets the owner and an admin change an item, and nobody else", async () => {
    const item = (await create(w.m1, w.slug, 1, { title: "Permission check" })).body.items[0];
    for (const body of [
      { title: "x" },
      { status: "IN_PROGRESS" },
      { ownerId: w.m2.id },
      { status: "DONE", afterId: null },
      { dueDate: day(1) },
    ]) {
      const res = await patch(w.m2, w.slug, item.id, body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
    }
    expect(await prisma.actionItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      title: "Permission check",
      ownerId: w.m1.id,
      status: "OPEN",
    });
    expect((await patch(w.m1, w.slug, item.id, { title: "By the owner" })).status).toBe(200);
    expect((await patch(w.admin, w.slug, item.id, { title: "By an admin" })).status).toBe(200);
    expect((await patch(w.a.owner, w.slug, item.id, { title: "By the workspace owner" })).status).toBe(200);
  });

  it("lets every member see everyone's items", async () => {
    const item = (await create(w.m1, w.slug, 1, { title: "Visible to all" })).body.items[0];
    expect((await one(w.m2, w.slug, item.id)).status).toBe(200);
    expect((await list(w.m2, w.slug, "q=Visible to all")).body.items).toHaveLength(1);
  });

  it("lets only admins and owners delete", async () => {
    const item = (await create(w.m1, w.slug, 1, { title: "Delete check" })).body.items[0];
    expect((await remove(w.m1, w.slug, item.id)).status).toBe(403); // not even its own owner
    expect((await remove(w.m2, w.slug, item.id)).status).toBe(403);
    expect(await prisma.actionItem.count({ where: { id: item.id } })).toBe(1);
    expect((await remove(w.admin, w.slug, item.id)).status).toBe(200);
    expect(await prisma.actionItem.count({ where: { id: item.id } })).toBe(0);
    const another = (await create(w.m1, w.slug, 1, { title: "Delete check 2" })).body.items[0];
    expect((await remove(w.a.owner, w.slug, another.id)).status).toBe(200);
    expect((await remove(w.admin, w.slug, another.id)).status).toBe(404);
  });

  it("checks the new owner when reassigning", async () => {
    const item = (await create(w.m1, w.slug, 1, { title: "Reassign" })).body.items[0];
    expect((await patch(w.m1, w.slug, item.id, { ownerId: w.outsider.id })).status).toBe(400);
    expect((await patch(w.m1, w.slug, item.id, { ownerId: "nobody" })).status).toBe(400);
    expect((await patch(w.m1, w.slug, item.id, { ownerId: w.m2.id })).body.items[0].ownerId).toBe(w.m2.id);
    // after handing it over, the previous owner can no longer change it
    expect((await patch(w.m1, w.slug, item.id, { title: "mine?" })).status).toBe(403);
  });

  it("rejects an empty or malformed patch", async () => {
    const item = (await create(w.m1, w.slug, 1, { title: "Patch shape" })).body.items[0];
    for (const body of [{}, { status: "NOPE" }, { title: "" }, { dueDate: "x" }, { afterId: 5 }]) {
      expect((await patch(w.m1, w.slug, item.id, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("status changes", () => {
  it("sets completedAt on DONE, clears it when moving away, and stamps again on re-completion", async () => {
    const item = (await create(w.m1, w.slug, 1, { title: "Complete me" })).body.items[0];
    const done = (await patch(w.m1, w.slug, item.id, { status: "DONE" })).body.items[0];
    expect(done.status).toBe("DONE");
    expect(Date.now() - new Date(done.completedAt).getTime()).toBeLessThan(60_000);
    // editing something else while done keeps the original completion time
    const edited = (await patch(w.m1, w.slug, item.id, { title: "Complete me (edited)" })).body.items[0];
    expect(edited.completedAt).toBe(done.completedAt);
    const reopened = (await patch(w.m1, w.slug, item.id, { status: "IN_PROGRESS" })).body.items[0];
    expect(reopened.completedAt).toBeNull();
    const again = (await patch(w.m1, w.slug, item.id, { status: "DONE" })).body.items[0];
    expect(again.completedAt).not.toBeNull();
  });

  it("writes one timeline event each time an item is completed, not for other moves", async () => {
    const item = (await create(w.m1, w.slug, 3, { title: "Completion events" })).body.items[0];
    const count = () =>
      prisma.event.count({
        where: {
          incidentId: w.inc.second.incident.id,
          type: "RITUAL_COMPLETED",
          payload: { path: ["actionItemId"], equals: item.id },
        },
      });
    await patch(w.m1, w.slug, item.id, { status: "IN_PROGRESS" });
    expect(await count()).toBe(0);
    await patch(w.m1, w.slug, item.id, { status: "DONE" });
    expect(await count()).toBe(1);
    await patch(w.m1, w.slug, item.id, { title: "renamed" }); // still done: nothing new
    await patch(w.m1, w.slug, item.id, { status: "DONE" }); // same status: nothing new
    expect(await count()).toBe(1);
    await patch(w.m1, w.slug, item.id, { status: "OPEN" });
    await patch(w.m1, w.slug, item.id, { status: "DONE" });
    expect(await count()).toBe(2);
    const event = await prisma.event.findFirstOrThrow({
      where: { incidentId: w.inc.second.incident.id, type: "RITUAL_COMPLETED" },
    });
    expect(event).toMatchObject({ actorId: w.m1.id, source: "USER" });
  });

  it("requires a reason for WONT_DO, stores it, and clears it when leaving", async () => {
    const item = (await create(w.m1, w.slug, 1, { title: "Won't do me" })).body.items[0];
    for (const body of [{ status: "WONT_DO" }, { status: "WONT_DO", wontDoReason: "   " }]) {
      const res = await patch(w.m1, w.slug, item.id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors.wontDoReason).toEqual(["required"]);
    }
    expect((await prisma.actionItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("OPEN");
    const wont = (
      await patch(w.m1, w.slug, item.id, { status: "WONT_DO", wontDoReason: "  Superseded by the new design  " })
    ).body.items[0];
    expect(wont).toMatchObject({ status: "WONT_DO", wontDoReason: "Superseded by the new design", completedAt: null });
    // changing the reason later needs one too
    expect((await patch(w.m1, w.slug, item.id, { wontDoReason: "" })).status).toBe(400);
    expect((await patch(w.m1, w.slug, item.id, { wontDoReason: "Different reason" })).body.items[0].wontDoReason).toBe(
      "Different reason",
    );
    const back = (await patch(w.m1, w.slug, item.id, { status: "OPEN" })).body.items[0];
    expect(back).toMatchObject({ status: "OPEN", wontDoReason: null });
  });

  it("moves from DONE straight to WONT_DO and clears the completion", async () => {
    const item = (await create(w.m1, w.slug, 1, { title: "Done then dropped" })).body.items[0];
    await patch(w.m1, w.slug, item.id, { status: "DONE" });
    const res = (await patch(w.m1, w.slug, item.id, { status: "WONT_DO", wontDoReason: "Not needed after all" })).body
      .items[0];
    expect(res).toMatchObject({ status: "WONT_DO", completedAt: null });
  });
});

describe("ordering", () => {
  const column = async (status: string) =>
    (await prisma.actionItem.findMany({ where: { workspaceId: w.ws, status: status as never } })).sort(byPosition);
  const fresh = async (status: string) => {
    await prisma.actionItem.deleteMany({ where: { workspaceId: w.ws, status: status as never } });
  };

  async function three(status: "IN_PROGRESS" | "DONE" = "IN_PROGRESS") {
    await fresh(status);
    const mk = async (title: string, position: string) =>
      seed({ title, status, position, ownerId: w.m1.id, ...(status === "DONE" ? { completedAt: new Date() } : {}) });
    return [await mk("A", "a0"), await mk("B", "a1"), await mk("C", "a2")];
  }

  it("places a dropped card strictly between the two it was dropped between", async () => {
    const [a, b, c] = await three();
    const moving = await seed({ title: "Mover", status: "OPEN", position: "b0" });
    const res = await patch(w.m1, w.slug, moving.id, { status: "IN_PROGRESS", afterId: a.id, beforeId: b.id });
    expect(res.status).toBe(200);
    const p = res.body.items[0].position as string;
    expect(a.position < p && p < b.position).toBe(true);
    expect((await column("IN_PROGRESS")).map((i) => i.title)).toEqual(["A", "Mover", "B", "C"]);
    void c;
  });

  it("places at the top, the bottom, and in an empty column", async () => {
    const [a, , c] = await three();
    const top = await seed({ title: "Top", status: "OPEN", position: "b1" });
    const bottom = await seed({ title: "Bottom", status: "OPEN", position: "b2" });
    await patch(w.m1, w.slug, top.id, { status: "IN_PROGRESS", beforeId: a.id });
    await patch(w.m1, w.slug, bottom.id, { status: "IN_PROGRESS", afterId: c.id });
    expect((await column("IN_PROGRESS")).map((i) => i.title)).toEqual(["Top", "A", "B", "C", "Bottom"]);
    await fresh("WONT_DO");
    const lone = await seed({ title: "Lone", status: "OPEN", position: "b3" });
    const moved = await patch(w.m1, w.slug, lone.id, { status: "WONT_DO", wontDoReason: "no" });
    expect(moved.status).toBe(200);
    expect((await column("WONT_DO")).map((i) => i.title)).toEqual(["Lone"]);
  });

  it("reorders within a column, and moving without a slot appends", async () => {
    const [a, b, c] = await three();
    await patch(w.m1, w.slug, c.id, { afterId: null, beforeId: a.id }); // C to the top
    expect((await column("IN_PROGRESS")).map((i) => i.title)).toEqual(["C", "A", "B"]);
    await patch(w.m1, w.slug, c.id, { afterId: b.id }); // and back to the bottom
    expect((await column("IN_PROGRESS")).map((i) => i.title)).toEqual(["A", "B", "C"]);
    await patch(w.m1, w.slug, a.id, { status: "DONE" }); // no slot: end of Done
    await patch(w.m1, w.slug, b.id, { status: "DONE" });
    const done = (await column("DONE")).map((i) => i.title);
    expect(done.slice(-2)).toEqual(["A", "B"]);
  });

  it("lands next to the card it was dropped beside even if the column changed meanwhile", async () => {
    const [a, b] = await three();
    const mover = await seed({ title: "Late", status: "OPEN", position: "c0" });
    await seed({ title: "Squatter", status: "IN_PROGRESS", position: "a05" }); // someone dropped here first
    await patch(w.m1, w.slug, mover.id, { status: "IN_PROGRESS", afterId: a.id, beforeId: b.id });
    const order = (await column("IN_PROGRESS")).map((i) => i.title);
    expect(order.indexOf("Late")).toBe(order.indexOf("A") + 1);
    expect(new Set((await column("IN_PROGRESS")).map((i) => i.position)).size).toBe(order.length); // no duplicates
  });

  it("gives two simultaneous drops into the same slot distinct, ordered positions", async () => {
    const [a, b] = await three();
    const x = await seed({ title: "X", status: "OPEN", position: "d0" });
    const y = await seed({ title: "Y", status: "OPEN", position: "d1" });
    const z = await seed({ title: "Z", status: "OPEN", position: "d2" });
    const results = await Promise.all(
      [x, y, z].map((i) => patch(w.m1, w.slug, i.id, { status: "IN_PROGRESS", afterId: a.id, beforeId: b.id })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const col = await column("IN_PROGRESS");
    expect(new Set(col.map((i) => i.position)).size).toBe(col.length);
    // all three landed between A and B
    const titles = col.map((i) => i.title);
    expect(titles[0]).toBe("A");
    expect(titles.indexOf("B")).toBe(4);
    expect(new Set(titles.slice(1, 4))).toEqual(new Set(["X", "Y", "Z"]));
    expect([...col].sort(byPosition).map((i) => i.id)).toEqual(col.map((i) => i.id)); // already total-ordered
  });

  it("rebalances a column whose positions collide, keeping the order", async () => {
    await fresh("IN_PROGRESS");
    // legacy rows all share one position; ties break by id
    const rows = await Promise.all(
      ["p", "q", "r", "s"].map((t) => seed({ title: t, status: "IN_PROGRESS", position: "a0" })),
    );
    const orderBefore = [...rows].sort(byPosition).map((r) => r.id);
    const mover = await seed({ title: "M", status: "OPEN", position: "e0" });
    const target = orderBefore[1];
    const res = await patch(w.m1, w.slug, mover.id, { status: "IN_PROGRESS", afterId: target });
    expect(res.status).toBe(200);
    const col = await column("IN_PROGRESS");
    expect(new Set(col.map((i) => i.position)).size).toBe(5);
    expect(col.map((i) => i.id)).toEqual([orderBefore[0], orderBefore[1], mover.id, orderBefore[2], orderBefore[3]]);
  });

  it("rebalances when keys have grown long, preserving order", async () => {
    await fresh("IN_PROGRESS");
    const long = "a0" + "V".repeat(60);
    const rows = [
      await seed({ title: "one", status: "IN_PROGRESS", position: "a0" }),
      await seed({ title: "two", status: "IN_PROGRESS", position: long }),
      await seed({ title: "three", status: "IN_PROGRESS", position: "a1" }),
    ];
    const mover = await seed({ title: "M", status: "OPEN", position: "e1" });
    await patch(w.m1, w.slug, mover.id, { status: "IN_PROGRESS", afterId: rows[0].id });
    const col = await column("IN_PROGRESS");
    expect(col.map((i) => i.title)).toEqual(["one", "M", "two", "three"]);
    expect(Math.max(...col.map((i) => i.position.length))).toBeLessThan(10);
  });

  it("ignores a neighbour id from another column or workspace, and appends instead", async () => {
    const [a] = await three();
    const theirs = (await create(w.b.owner, w.bSlug, 1, { title: "B item" })).body.items[0];
    const mover = await seed({ title: "Stray", status: "OPEN", position: "f0" });
    await patch(w.m1, w.slug, mover.id, { status: "IN_PROGRESS", afterId: theirs.id });
    const col = (await column("IN_PROGRESS")).map((i) => i.title);
    expect(col.at(-1)).toBe("Stray");
    void a;
  });

  it("keeps positions in byte order (a lowercase key sorts after an uppercase one)", async () => {
    await fresh("IN_PROGRESS");
    await seed({ title: "upper", status: "IN_PROGRESS", position: "aZ" });
    await seed({ title: "lower", status: "IN_PROGRESS", position: "aa" });
    const viaDb = await prisma.actionItem.findMany({
      where: { workspaceId: w.ws, status: "IN_PROGRESS" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    expect(viaDb.map((i) => i.title)).toEqual(["upper", "lower"]); // 'Z' (0x5A) < 'a' (0x61), as the app expects
  });
});

describe("reading: list and board", () => {
  let r: {
    ws: string;
    slug: string;
    owner: { id: string };
    m: { id: string };
    inc1: { incident: { id: string }; postmortem: { id: string } };
    inc2: { incident: { id: string }; postmortem: { id: string } };
  };

  async function readWorld() {
    const team = await createTeam("ai-read");
    const m = await addMember(team.workspace.id, "MEMBER");
    const ws = team.workspace.id;
    const inc1 = await incidentWithPostmortem(ws, team.owner.id, 1);
    const inc2 = await incidentWithPostmortem(ws, team.owner.id, 2);
    return { ws, slug: team.workspace.slug, owner: team.owner, m, inc1, inc2 };
  }
  const mk = (over: Record<string, unknown>, which: "inc1" | "inc2" = "inc1") =>
    prisma.actionItem.create({
      data: {
        workspaceId: r.ws,
        postmortemId: r[which].postmortem.id,
        incidentId: r[which].incident.id,
        title: "item",
        ownerId: r.owner.id,
        createdById: r.owner.id,
        ...over,
      } as never,
    });
  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

  beforeAll(async () => {
    r = await readWorld();
  });

  it("filters by owner (me, anyone, a person)", async () => {
    const mine = await mk({ title: "owner-mine", ownerId: r.m.id });
    const theirs = await mk({ title: "owner-theirs", ownerId: r.owner.id });
    const asM = { id: r.m.id, email: "x", name: "x" };
    const q = (qs: string) =>
      call(asM, listRoute.GET, `/api/w/${r.slug}/action-items?q=owner-&${qs}`, { params: { slug: r.slug } });
    expect(ids(await q("owner=me"))).toEqual([mine.id]);
    expect(new Set(ids(await q("owner=any")))).toEqual(new Set([mine.id, theirs.id]));
    expect(ids(await q(`owner=${r.owner.id}`))).toEqual([theirs.id]);
    expect((await q("")).body.items).toHaveLength(2); // default is anyone
  });

  it("filters overdue and due-this-week by date, ignoring finished items", async () => {
    const overdue = await mk({ title: "dt-overdue", dueDate: dayDate(day(-2)) });
    const today = await mk({ title: "dt-today", dueDate: dayDate(day(0)) });
    const week = await mk({ title: "dt-week", dueDate: dayDate(day(7)) });
    const later = await mk({ title: "dt-later", dueDate: dayDate(day(8)) });
    await mk({ title: "dt-done", status: "DONE", completedAt: new Date(), dueDate: dayDate(day(-5)) });
    await mk({ title: "dt-wont", status: "WONT_DO", wontDoReason: "x", dueDate: dayDate(day(-5)) });
    await mk({ title: "dt-nodate" });
    const q = (qs: string) =>
      call({ id: r.owner.id, email: "x", name: "x" }, listRoute.GET, `/api/w/${r.slug}/action-items?q=dt-&${qs}`, {
        params: { slug: r.slug },
      });
    expect(ids(await q("overdue=1"))).toEqual([overdue.id]);
    expect(new Set(ids(await q("dueThisWeek=1")))).toEqual(new Set([today.id, week.id]));
    expect(new Set(ids(await q("overdue=1&dueThisWeek=1")))).toEqual(new Set());
    void later;
  });

  it("filters by incident number and by text in the title or description, literally", async () => {
    const a = await mk({ title: "inc-one" }, "inc1");
    const b = await mk({ title: "inc-two", description: "Mentions 50% of nodes" }, "inc2");
    const q = (qs: string) =>
      call({ id: r.owner.id, email: "x", name: "x" }, listRoute.GET, `/api/w/${r.slug}/action-items?${qs}`, {
        params: { slug: r.slug },
      });
    expect(ids(await q("q=inc-&incident=1"))).toEqual([a.id]);
    expect(ids(await q("q=inc-&incident=2"))).toEqual([b.id]);
    expect(ids(await q("q=50%25 of"))).toEqual([b.id]); // % is literal
    expect(ids(await q("q=INC-ONE"))).toEqual([a.id]); // case-insensitive
    expect((await q("incident=abc")).status).toBe(400);
    expect((await q("owner=")).status).toBe(200);
  });

  it("pages through items with the same due date exactly once", async () => {
    await prisma.actionItem.deleteMany({ where: { workspaceId: r.ws } });
    const created = [];
    for (let i = 0; i < 23; i += 1)
      created.push(await mk({ title: `page-${i}`, dueDate: dayDate(day(i % 3 === 0 ? 1 : 5)) }));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const res: Awaited<ReturnType<typeof list>> = await list(
        { id: r.owner.id, email: "x", name: "x" },
        r.slug,
        `limit=5${cursor ? `&cursor=${cursor}` : ""}`,
      );
      seen.push(...ids(res));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
    // earliest due date first, no-date last
    const dues = (await list({ id: r.owner.id, email: "x", name: "x" }, r.slug, "limit=100")).body.items.map(
      (i: { dueDate: string | null }) => i.dueDate,
    );
    expect(dues).toEqual([...dues].sort());
    expect((await list({ id: r.owner.id, email: "x", name: "x" }, r.slug, "limit=0")).status).toBe(400);
    expect((await list({ id: r.owner.id, email: "x", name: "x" }, r.slug, "sort=bogus")).status).toBe(400);
  });

  it("groups the board by status in position order, with counts and per-column pages", async () => {
    await prisma.actionItem.deleteMany({ where: { workspaceId: r.ws } });
    for (let i = 0; i < 30; i += 1)
      await mk({ title: `open-${i}`, status: "OPEN", position: `a${String(i).padStart(2, "0")}` });
    for (let i = 0; i < 3; i += 1) await mk({ title: `wip-${i}`, status: "IN_PROGRESS", position: `a${i}` });
    const me = { id: r.owner.id, email: "x", name: "x" };
    const res = await board(me, r.slug);
    expect(res.status).toBe(200);
    expect(res.body.columns.map((c: { status: string }) => c.status)).toEqual([
      "OPEN",
      "IN_PROGRESS",
      "DONE",
      "WONT_DO",
    ]);
    const open = res.body.columns[0];
    expect(open.count).toBe(30);
    expect(open.items).toHaveLength(25); // per-column default limit
    expect(open.items.map((i: { title: string }) => i.title)).toEqual(
      Array.from({ length: 25 }, (_, i) => `open-${i}`),
    );
    expect(open.nextCursor).toBeTruthy();
    expect(res.body.columns[1]).toMatchObject({ count: 3, nextCursor: null });
    expect(res.body.today).toBe(TODAY);

    // page just that column, no overlap
    const next = await board(me, r.slug, `column=OPEN&cursor=${open.nextCursor}`);
    expect(next.body.columns).toHaveLength(1);
    expect(next.body.columns[0].items.map((i: { title: string }) => i.title)).toEqual(
      Array.from({ length: 5 }, (_, i) => `open-${25 + i}`),
    );
    expect(next.body.columns[0].nextCursor).toBeNull();
    const small = await board(me, r.slug, "limit=7");
    expect(small.body.columns[0].items).toHaveLength(7);
    expect((await board(me, r.slug, "column=NOPE")).status).toBe(400);
  });

  it("pages a column with tied positions without skipping or repeating", async () => {
    await prisma.actionItem.deleteMany({ where: { workspaceId: r.ws } });
    for (let i = 0; i < 12; i += 1) await mk({ title: `tie-${i}`, status: "IN_PROGRESS", position: "a0" });
    const me = { id: r.owner.id, email: "x", name: "x" };
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const res: Awaited<ReturnType<typeof board>> = await board(
        me,
        r.slug,
        `column=IN_PROGRESS&limit=5${cursor ? `&cursor=${cursor}` : ""}`,
      );
      seen.push(...res.body.columns[0].items.map((i: { id: string }) => i.id));
      cursor = res.body.columns[0].nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it("shows Done and Won't do from the last 14 days by default, and everything with all=1", async () => {
    await prisma.actionItem.deleteMany({ where: { workspaceId: r.ws } });
    const recentDone = await mk({ title: "done-recent", status: "DONE", completedAt: new Date(Date.now() - 13 * DAY) });
    await mk({ title: "done-old", status: "DONE", completedAt: new Date(Date.now() - 15 * DAY) });
    const recentWont = await mk({
      title: "wont-recent",
      status: "WONT_DO",
      wontDoReason: "x",
      updatedAt: new Date(Date.now() - 2 * DAY),
    });
    await prisma.actionItem.updateMany({ where: { title: "wont-old" }, data: {} });
    const old = await mk({ title: "wont-old", status: "WONT_DO", wontDoReason: "x" });
    await prisma.$executeRawUnsafe(
      `UPDATE "${process.env.DATABASE_SCHEMA}"."ActionItem" SET "updatedAt" = now() - interval '30 days' WHERE id = '${old.id}'`,
    );
    const me = { id: r.owner.id, email: "x", name: "x" };
    const recent = await board(me, r.slug);
    const title = (s: string) =>
      recent.body.columns.find((c: { status: string }) => c.status === s).items.map((i: { title: string }) => i.title);
    expect(title("DONE")).toEqual(["done-recent"]);
    expect(title("WONT_DO")).toEqual(["wont-recent"]);
    expect(recent.body.columns[2].count).toBe(1); // the count follows the filter
    const all = await board(me, r.slug, "all=1");
    expect(all.body.columns[2].items.map((i: { title: string }) => i.title).sort()).toEqual([
      "done-old",
      "done-recent",
    ]);
    expect(all.body.columns[3].items.map((i: { title: string }) => i.title).sort()).toEqual([
      "wont-old",
      "wont-recent",
    ]);
    void recentDone;
    void recentWont;
  });
});

describe("soft-deleted incidents", () => {
  it("hide their items from the board, lists, counts and progress", async () => {
    const item = await seed({ title: "On a doomed incident", number: 4, ownerId: w.m1.id, dueDate: dayDate(day(-3)) });
    const incidentId = w.inc.deleted.incident.id;
    const me = w.m1;
    const present = async () => ({
      list: (await list(me, w.slug, "q=doomed")).body.items.length,
      board: (await board(me, w.slug)).body.columns
        .flatMap((c: { items: { id: string }[] }) => c.items)
        .filter((i: { id: string }) => i.id === item.id).length,
      one: (await one(me, w.slug, item.id)).status,
      overdue: await countMyOverdue(scopedDb(w.ws), w.m1.id),
      progress: (await progressBy(scopedDb(w.ws), "incidentId", [incidentId])).get(incidentId)!,
    });
    const before = await present();
    expect(before).toMatchObject({ list: 1, board: 1, one: 200 });
    expect(before.progress).toEqual({ done: 0, total: 1, overdue: 1 });
    await prisma.incident.update({ where: { id: incidentId }, data: { deletedAt: new Date() } });
    const after = await present();
    expect(after).toMatchObject({ list: 0, board: 0, one: 404 });
    expect(after.progress).toEqual({ done: 0, total: 0, overdue: 0 });
    expect(after.overdue).toBe(before.overdue - 1);
    expect((await patch(w.m1, w.slug, item.id, { title: "x" })).status).toBe(404);
    expect((await create(w.m1, w.slug, 4, { title: "x" })).status).toBe(404);
    expect((await remove(w.admin, w.slug, item.id)).status).toBe(404);
  });
});

describe("progress and counts", () => {
  it("counts done of total (not counting won't do) and overdue, per incident and per postmortem", async () => {
    const team = await createTeam("ai-prog");
    const ws = team.workspace.id;
    const a = await incidentWithPostmortem(ws, team.owner.id, 1);
    const b = await incidentWithPostmortem(ws, team.owner.id, 2);
    const mk = (target: typeof a, over: Record<string, unknown>) =>
      prisma.actionItem.create({
        data: {
          workspaceId: ws,
          postmortemId: target.postmortem.id,
          incidentId: target.incident.id,
          title: "p",
          ownerId: team.owner.id,
          createdById: team.owner.id,
          ...over,
        } as never,
      });
    await mk(a, { status: "DONE", completedAt: new Date() });
    await mk(a, { status: "DONE", completedAt: new Date() });
    await mk(a, { status: "OPEN", dueDate: dayDate(day(-1)) });
    await mk(a, { status: "IN_PROGRESS", dueDate: dayDate(day(-9)) });
    await mk(a, { status: "OPEN", dueDate: dayDate(day(4)) });
    await mk(a, { status: "WONT_DO", wontDoReason: "x", dueDate: dayDate(day(-9)) }); // never counted, never overdue
    await mk(a, { status: "DONE", completedAt: new Date(), dueDate: dayDate(day(-9)) }); // done is not overdue
    await mk(b, { status: "OPEN" });
    const db = scopedDb(ws);
    const byIncident = await progressBy(db, "incidentId", [a.incident.id, b.incident.id]);
    expect(byIncident.get(a.incident.id)).toEqual({ done: 3, total: 6, overdue: 2 });
    expect(byIncident.get(b.incident.id)).toEqual({ done: 0, total: 1, overdue: 0 });
    const byPostmortem = await progressBy(db, "postmortemId", [a.postmortem.id]);
    expect(byPostmortem.get(a.postmortem.id)).toEqual({ done: 3, total: 6, overdue: 2 });
    expect((await progressBy(db, "incidentId", [])).size).toBe(0);
    expect((await progressBy(db, "incidentId", ["missing"])).get("missing")).toEqual({ done: 0, total: 0, overdue: 0 });
    expect(await countMyOverdue(db, team.owner.id)).toBe(2);
    // another workspace's incident id yields nothing
    const other = await progressBy(scopedDb(w.ws), "incidentId", [a.incident.id]);
    expect(other.get(a.incident.id)).toEqual({ done: 0, total: 0, overdue: 0 });
  });
});
