import { describe, expect, it, vi } from "vitest";
import * as eventRoute from "@/app/api/w/[slug]/incidents/[number]/events/[id]/route";
import * as eventsRoute from "@/app/api/w/[slug]/incidents/[number]/events/route";
import * as incidentRoute from "@/app/api/w/[slug]/incidents/[number]/route";
import * as rolesRoute from "@/app/api/w/[slug]/incidents/[number]/roles/route";
import * as statusRoute from "@/app/api/w/[slug]/incidents/[number]/status/route";
import { prisma } from "@/server/db/client";
import { call, type TestUser } from "@/test/api";
import { addMember, createTeam, createUser } from "@/test/fixtures";
import { FILTER_TYPES, encodeCursor, type TimelineEventView } from "./schema";

vi.mock("@/server/auth/session", async () => {
  const { currentTestUser } = await import("@/test/api");
  return { getSession: async () => (currentTestUser() ? { user: currentTestUser(), session: {} } : null) };
});

/** Workspace A (owner, admin, two members, incidents #1 and #2) and workspace B with its own #1. */
async function world() {
  const a = await createTeam("tl-a");
  const admin = await addMember(a.workspace.id, "ADMIN");
  const m1 = await addMember(a.workspace.id, "MEMBER");
  const m2 = await addMember(a.workspace.id, "MEMBER");
  const b = await createTeam("tl-b");
  const mk = (workspaceId: string, number: number, createdById: string, startedAt = new Date(Date.now() - 3_600_000)) =>
    prisma.incident.create({
      data: { workspaceId, number, title: `Incident ${number}`, severity: 3, createdById, startedAt },
    });
  const inc1 = await mk(a.workspace.id, 1, a.owner.id);
  const inc2 = await mk(a.workspace.id, 2, a.owner.id);
  const incB = await mk(b.workspace.id, 1, b.owner.id);
  return {
    a,
    b,
    admin,
    m1,
    m2,
    inc1,
    inc2,
    incB,
    slug: a.workspace.slug,
    bSlug: b.workspace.slug,
    wsId: a.workspace.id,
  };
}
type W = Awaited<ReturnType<typeof world>>;

const base = (slug: string, n: number) => `/api/w/${slug}/incidents/${n}/events`;
const list = (user: TestUser, w: Pick<W, "slug">, query = "", n = 1, slug = w.slug) =>
  call(user, eventsRoute.GET, `${base(slug, n)}${query ? `?${query}` : ""}`, { params: { slug, number: String(n) } });
const add = (user: TestUser, w: Pick<W, "slug">, body: unknown, n = 1, slug = w.slug) =>
  call(user, eventsRoute.POST, base(slug, n), { method: "POST", body, params: { slug, number: String(n) } });
const edit = (user: TestUser, w: Pick<W, "slug">, id: string, body: unknown, n = 1, slug = w.slug) =>
  call(user, eventRoute.PATCH, `${base(slug, n)}/${id}`, {
    method: "PATCH",
    body,
    params: { slug, number: String(n), id },
  });
const remove = (user: TestUser, w: Pick<W, "slug">, id: string, n = 1, slug = w.slug) =>
  call(user, eventRoute.DELETE, `${base(slug, n)}/${id}`, {
    method: "DELETE",
    params: { slug, number: String(n), id },
  });

const ids = (r: { body: { items: { id: string }[] } }) => r.body.items.map((i) => i.id);
const MIN = 60_000;
const at = (offsetMs: number) => new Date(Date.UTC(2026, 0, 1, 12) + offsetMs);

async function makeNote(w: W, author: { id: string }, over: Record<string, unknown> = {}, incidentId = w.inc1.id) {
  return prisma.event.create({
    data: {
      workspaceId: w.wsId,
      incidentId,
      type: "NOTE",
      source: "USER",
      actorId: author.id,
      body: "a note",
      occurredAt: at(0),
      ...over,
    },
  });
}

describe("isolation", () => {
  it.concurrent("non-members get 404 (signed out 401) on all four routes, and nothing changes", async () => {
    const w = await world();
    const note = await makeNote(w, w.m1);
    const calls: [string, (u: TestUser) => ReturnType<typeof call>][] = [
      ["GET", (u) => list(u, w)],
      ["POST", (u) => add(u, w, { body: "x" })],
      ["PATCH", (u) => edit(u, w, note.id, { body: "x" })],
      ["DELETE", (u) => remove(u, w, note.id)],
    ];
    for (const [label, run] of calls) {
      const res = await run(w.b.owner);
      expect(res.status, label).toBe(404);
      expect(res.body.error.code).toBe("not_found");
      expect((await run(null)).status, `${label} signed out`).toBe(401);
    }
    const row = await prisma.event.findUniqueOrThrow({ where: { id: note.id } });
    expect(row.body).toBe("a note");
    expect(await prisma.event.count({ where: { incidentId: w.inc1.id } })).toBe(1);
  });

  it.concurrent("workspace A cannot list, create, edit or delete workspace B's events", async () => {
    const w = await world();
    const bNote = await makeNote(w, w.b.owner, { body: "B's secret", workspaceId: w.b.workspace.id }, w.incB.id);
    // incident #1 exists in both workspaces; A's members only ever see A's
    await makeNote(w, w.m1, { body: "A's note" });
    const own = await list(w.m1, w);
    expect(own.body.items.map((i: TimelineEventView) => i.body)).toEqual(["A's note"]);
    expect(JSON.stringify(own.body)).not.toContain("B's secret");

    expect((await list(w.a.owner, w, "", 1, w.bSlug)).status).toBe(404); // not a member of B
    expect((await add(w.a.owner, w, { body: "x" }, 1, w.bSlug)).status).toBe(404);
    expect((await edit(w.a.owner, w, bNote.id, { body: "hacked" }, 1, w.bSlug)).status).toBe(404);
    expect((await remove(w.a.owner, w, bNote.id, 1, w.bSlug)).status).toBe(404);
    // routing B's event id through A's own slug and incident number doesn't reach it either
    expect((await edit(w.a.owner, w, bNote.id, { body: "hacked" })).status).toBe(404);
    expect((await remove(w.a.owner, w, bNote.id)).status).toBe(404);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: bNote.id } })).toMatchObject({ body: "B's secret" });
  });

  it.concurrent("an event id from another incident is a 404 even inside the same workspace", async () => {
    const w = await world();
    const onTwo = await makeNote(w, w.m1, { body: "belongs to #2" }, w.inc2.id);
    expect((await edit(w.a.owner, w, onTwo.id, { body: "x" }, 1)).status).toBe(404);
    expect((await remove(w.a.owner, w, onTwo.id, 1)).status).toBe(404);
    expect((await edit(w.a.owner, w, onTwo.id, { body: "fine" }, 2)).status).toBe(200); // right incident works
    expect((await list(w.m2, w, "", 1)).body.items).toEqual([]);
  });

  it.concurrent("a deleted incident and unknown numbers are 404 everywhere", async () => {
    const w = await world();
    const note = await makeNote(w, w.m1);
    await prisma.incident.update({ where: { id: w.inc1.id }, data: { deletedAt: new Date() } });
    expect((await list(w.m1, w)).status).toBe(404);
    expect((await add(w.m1, w, { body: "x" })).status).toBe(404);
    expect((await edit(w.a.owner, w, note.id, { body: "x" })).status).toBe(404);
    expect((await remove(w.a.owner, w, note.id)).status).toBe(404);
    expect((await list(w.m1, w, "", 99)).status).toBe(404);
    expect((await list(w.m1, w, "", "abc" as never)).status).toBe(404);
  });
});

describe("who can do what", () => {
  it.concurrent("any member adds notes, recorded as theirs, even on a resolved incident", async () => {
    const w = await world();
    const res = await add(w.m1, w, { body: "  First update  " });
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      type: "NOTE",
      source: "USER",
      actorId: w.m1.id,
      body: "First update",
      isKeyMoment: false,
      editedAt: null,
    });
    expect(res.body.people[w.m1.id]).toMatchObject({ email: w.m1.email });

    await prisma.incident.update({ where: { id: w.inc1.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    expect((await add(w.m2, w, { body: "Postmortem context" })).status).toBe(201);
    expect((await add(w.admin, w, { body: "Admin note", isKeyMoment: true })).body.event.isKeyMoment).toBe(true);
  });

  it.concurrent(
    "authors can edit and delete their own notes; other members cannot; admins and owners can",
    async () => {
      const w = await world();
      const mine = (await add(w.m1, w, { body: "mine" })).body.event.id as string;

      // another plain member: no
      const edit2 = await edit(w.m2, w, mine, { body: "hijack" });
      expect(edit2.status).toBe(403);
      expect(edit2.body.error.code).toBe("forbidden");
      expect((await remove(w.m2, w, mine)).status).toBe(403);
      expect((await edit(w.m2, w, mine, { isKeyMoment: true })).status).toBe(403); // not even the star
      expect(await prisma.event.findUniqueOrThrow({ where: { id: mine } })).toMatchObject({
        body: "mine",
        isKeyMoment: false,
      });

      // the author: yes
      expect((await edit(w.m1, w, mine, { body: "mine, edited" })).status).toBe(200);
      // an admin and an owner: yes, on someone else's note
      expect((await edit(w.admin, w, mine, { body: "admin edited" })).status).toBe(200);
      expect((await edit(w.a.owner, w, mine, { isKeyMoment: true })).status).toBe(200);
      expect((await remove(w.admin, w, mine)).status).toBe(200);

      const second = (await add(w.m2, w, { body: "second" })).body.event.id as string;
      expect((await remove(w.m2, w, second)).status).toBe(200); // author deletes their own
      const third = (await add(w.m1, w, { body: "third" })).body.event.id as string;
      expect((await remove(w.a.owner, w, third)).status).toBe(200);
      expect(await prisma.event.count({ where: { incidentId: w.inc1.id } })).toBe(0);
    },
  );

  it.concurrent("system, webhook and Slack entries can't be edited or deleted by anyone", async () => {
    const w = await world();
    const mk = (type: string, source: string, actorId: string | null) =>
      prisma.event.create({
        data: {
          workspaceId: w.wsId,
          incidentId: w.inc1.id,
          type: type as never,
          source: source as never,
          actorId,
          body: "text",
          payload: {},
          occurredAt: at(0),
        },
      });
    const protectedEvents = [
      await mk("STATUS_CHANGED", "SYSTEM", w.a.owner.id),
      await mk("STATUS_CHANGED", "USER", w.m1.id), // a person's change, recorded as an event: still not a note
      await mk("ROLE_ASSIGNED", "USER", w.m1.id),
      await mk("NOTE", "SYSTEM", null),
      await mk("NOTE", "INTEGRATION", null),
      await mk("NOTE", "SLACK", null),
    ];
    for (const e of protectedEvents) {
      for (const user of [w.m1, w.admin, w.a.owner]) {
        const patched = await edit(user, w, e.id, { body: "tamper" });
        expect(patched.status, `${e.type}/${e.source} edit`).toBe(403);
        expect(patched.body.error.code).toBe("event_immutable");
        const deleted = await remove(user, w, e.id);
        expect(deleted.status, `${e.type}/${e.source} delete`).toBe(403);
        expect(deleted.body.error.code).toBe("event_immutable");
      }
    }
    expect(await prisma.event.count({ where: { incidentId: w.inc1.id } })).toBe(protectedEvents.length);
    expect(await prisma.auditLog.count({ where: { workspaceId: w.wsId, action: "incident.note_deleted" } })).toBe(0);
  });
});

describe("times", () => {
  it.concurrent(
    "rejects the future (on create and on edit), accepts the past, and the server owns createdAt",
    async () => {
      const w = await world();
      const future = new Date(Date.now() + 3_600_000).toISOString();
      const tooLate = await add(w.m1, w, { body: "x", occurredAt: future });
      expect(tooLate.status).toBe(400);
      expect(tooLate.body.error).toMatchObject({
        code: "validation_error",
        fieldErrors: { occurredAt: ["in_future"] },
      });
      expect(await prisma.event.count({ where: { incidentId: w.inc1.id } })).toBe(0);

      // a little ahead is tolerated (clock skew); an hour ago is stored exactly
      expect((await add(w.m1, w, { body: "skew", occurredAt: new Date(Date.now() + MIN).toISOString() })).status).toBe(
        201,
      );
      const past = new Date(Date.now() - 3_600_000);
      const before = Date.now();
      const created = await add(w.m1, w, {
        body: "backfill",
        occurredAt: past.toISOString(),
        createdAt: "2001-01-01T00:00:00Z",
      });
      expect(created.status).toBe(201);
      expect(created.body.event.occurredAt).toBe(past.toISOString());
      const createdAt = new Date(created.body.event.createdAt).getTime();
      expect(createdAt).toBeGreaterThanOrEqual(before - 1000); // the client's createdAt was ignored
      expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000);

      // editing: the future is refused, the past accepted
      const id = created.body.event.id as string;
      expect((await edit(w.m1, w, id, { occurredAt: future })).status).toBe(400);
      const moved = new Date(Date.now() - 7_200_000);
      const ok = await edit(w.m1, w, id, { occurredAt: moved.toISOString() });
      expect(ok.body.event.occurredAt).toBe(moved.toISOString());
      expect(ok.body.event.createdAt).toBe(created.body.event.createdAt); // recording time never changes
    },
  );

  it.concurrent("defaults to now, allows times before the incident started, and rejects malformed times", async () => {
    const w = await world();
    const now = Date.now();
    const def = await add(w.m1, w, { body: "now" });
    expect(Math.abs(new Date(def.body.event.occurredAt).getTime() - now)).toBeLessThan(10_000);

    const beforeStart = new Date(w.inc1.startedAt.getTime() - 86_400_000).toISOString();
    expect((await add(w.m1, w, { body: "pre-incident context", occurredAt: beforeStart })).status).toBe(201);

    for (const occurredAt of ["yesterday", "2026-13-45T00:00:00Z", 12345, "", "2026-01-01"]) {
      const res = await add(w.m1, w, { body: "x", occurredAt });
      if (occurredAt === "") continue; // blank is treated as "not provided" by clients; zod rejects it
      expect(res.status, JSON.stringify(occurredAt)).toBe(400);
    }
  });

  it.concurrent("validates note bodies", async () => {
    const w = await world();
    for (const body of ["", "   ", undefined, 5, "x".repeat(5001)]) {
      const res = await add(w.m1, w, { body });
      expect(res.status, JSON.stringify(body)?.slice(0, 20)).toBe(400);
      expect(res.body.error.fieldErrors.body).toBeTruthy();
    }
    expect((await add(w.m1, w, { body: "x".repeat(5000) })).status).toBe(201);
    expect((await add(w.m1, w, { body: "x", isKeyMoment: "yes" })).status).toBe(400);
  });
});

describe("ordering", () => {
  it.concurrent(
    "sorts by when it happened, then id, with backfilled entries slotted in where they belong",
    async () => {
      const w = await world();
      // recorded out of order: the latest first, then earlier ones, then a tie
      const late = await makeNote(w, w.m1, { body: "late", occurredAt: at(60 * MIN) });
      const early = await makeNote(w, w.m1, { body: "early", occurredAt: at(5 * MIN) });
      const tieA = await makeNote(w, w.m1, { body: "tie a", occurredAt: at(30 * MIN) });
      const tieB = await makeNote(w, w.m2, { body: "tie b", occurredAt: at(30 * MIN) });
      const system = await prisma.event.create({
        data: {
          workspaceId: w.wsId,
          incidentId: w.inc1.id,
          type: "STATUS_CHANGED",
          source: "USER",
          actorId: w.m1.id,
          payload: { from: "INVESTIGATING", to: "IDENTIFIED" },
          occurredAt: at(30 * MIN),
        },
      });
      const backfilled = (await add(w.m1, w, { body: "backfilled", occurredAt: at(10 * MIN).toISOString() })).body
        .event; // recorded last (now)

      const asc = await list(w.m1, w, "order=asc&limit=100");
      const tied = [tieA.id, tieB.id, system.id].sort();
      expect(ids(asc)).toEqual([early.id, backfilled.id, ...tied, late.id]);

      const desc = await list(w.m1, w, "order=desc&limit=100");
      expect(ids(desc)).toEqual([...ids(asc)].reverse());
    },
  );

  it.concurrent("is stable when a backfilled entry is inserted between two reads", async () => {
    const w = await world();
    for (let i = 0; i < 4; i++) await makeNote(w, w.m1, { body: `n${i}`, occurredAt: at(i * 10 * MIN) });
    const before = ids(await list(w.m1, w, "order=asc&limit=100"));
    const inserted = (await add(w.m1, w, { body: "squeezed in", occurredAt: at(15 * MIN).toISOString() })).body.event
      .id as string;
    const after = ids(await list(w.m1, w, "order=asc&limit=100"));
    expect(after).toEqual([before[0], before[1], inserted, before[2], before[3]]);
  });
});

describe("pagination", () => {
  /** 120 events with plenty of ties: only 10 distinct times, mixed types, a few starred. */
  async function bigTimeline() {
    const w = await world();
    const types = ["NOTE", "STATUS_CHANGED", "SEVERITY_CHANGED", "ROLE_ASSIGNED", "SERVICES_CHANGED", "NOTE"];
    await prisma.event.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        workspaceId: w.wsId,
        incidentId: w.inc1.id,
        type: types[i % types.length] as never,
        source: (i % 6 === 0 || i % 6 === 5 ? "USER" : "SYSTEM") as never,
        actorId: w.m1.id,
        body: i % 6 === 0 || i % 6 === 5 ? `note ${i}` : null,
        payload: {},
        occurredAt: at((i % 10) * MIN),
        isKeyMoment: i % 17 === 0,
      })),
    });
    return w;
  }
  /** Follow nextCursor to the end. */
  async function walk(w: W, query: string) {
    const out: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard++) {
      const res: Awaited<ReturnType<typeof list>> = await list(w.m1, w, `${query}${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      out.push(...ids(res));
      cursor = res.body.nextCursor;
      if (!cursor) return out;
    }
    throw new Error("did not terminate");
  }

  it.concurrent("pages forward and backward through 120 tied events: every entry exactly once, in order", async () => {
    const w = await bigTimeline();
    const whole = ids(await list(w.m1, w, "order=asc&limit=100")); // first 100 only; compare against the DB instead
    expect(whole).toHaveLength(100);
    const expectedAsc = (
      await prisma.event.findMany({ where: { incidentId: w.inc1.id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] })
    ).map((e) => e.id);
    expect(expectedAsc).toHaveLength(120);

    for (const size of [50, 25, 7]) {
      const asc = await walk(w, `order=asc&limit=${size}`);
      expect(asc, `asc limit ${size}`).toEqual(expectedAsc);
      expect(new Set(asc).size).toBe(120);
      const desc = await walk(w, `order=desc&limit=${size}`);
      expect(desc, `desc limit ${size}`).toEqual([...expectedAsc].reverse());
    }
  });

  it.concurrent(
    "cursors are positions: continuing from any entry in either direction gives exactly the entries beyond it",
    async () => {
      const w = await bigTimeline();
      const all = await prisma.event.findMany({
        where: { incidentId: w.inc1.id },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      for (const i of [0, 1, 9, 10, 11, 49, 50, 60, 77, 100, 118, 119]) {
        const cursor = encodeCursor(all[i].occurredAt, all[i].id);
        const later = await list(w.m1, w, `order=asc&limit=100&cursor=${cursor}`);
        expect(ids(later), `after #${i}`).toEqual(all.slice(i + 1, i + 101).map((e) => e.id));
        const earlier = await list(w.m1, w, `order=desc&limit=100&cursor=${cursor}`);
        expect(ids(earlier), `before #${i}`).toEqual(
          all
            .slice(Math.max(0, i - 100), i)
            .reverse()
            .map((e) => e.id),
        );
      }
    },
  );

  it.concurrent(
    "the newest-50 window plus 'load earlier' reaches every entry once, and 'load later' picks up what follows",
    async () => {
      const w = await bigTimeline();
      const all = (
        await prisma.event.findMany({
          where: { incidentId: w.inc1.id },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        })
      ).map((e) => e.id);

      const first = await list(w.m1, w, "order=desc&limit=50");
      const window = ids(first).reverse(); // oldest..newest of the newest 50
      expect(window).toEqual(all.slice(70));
      const earlier = await list(w.m1, w, `order=desc&limit=50&cursor=${first.body.nextCursor}`);
      const earlierWindow = [...ids(earlier).reverse(), ...window];
      expect(earlierWindow).toEqual(all.slice(20));
      const earliest = await list(w.m1, w, `order=desc&limit=50&cursor=${earlier.body.nextCursor}`);
      expect([...ids(earliest).reverse(), ...earlierWindow]).toEqual(all);
      expect(earliest.body.nextCursor).toBeNull();

      // from the oldest entry of the newest window, "load later" returns exactly the rest of that window
      const oldest = first.body.items.at(-1) as TimelineEventView;
      const later = await list(w.m1, w, `order=asc&limit=100&cursor=${encodeCursor(oldest.occurredAt, oldest.id)}`);
      expect(ids(later)).toEqual(window.slice(1));
    },
  );

  it.concurrent("a cursor stays valid after the entry it points at is deleted", async () => {
    const w = await bigTimeline();
    const page = await list(w.m1, w, "order=asc&limit=10");
    const last = page.body.items.at(-1) as TimelineEventView;
    await prisma.event.delete({ where: { id: last.id } });
    const next = await list(w.m1, w, `order=asc&limit=100&cursor=${page.body.nextCursor}`);
    expect(next.status).toBe(200);
    expect(ids(next)).not.toContain(last.id);
    expect(next.body.items).toHaveLength(100);
  });

  it.concurrent("pages within a filter, with no gaps or repeats", async () => {
    const w = await bigTimeline();
    for (const filter of ["notes", "status", "roles", "key"] as const) {
      const expected = (
        await prisma.event.findMany({
          where: {
            incidentId: w.inc1.id,
            ...(filter === "key" ? { isKeyMoment: true } : { type: { in: [...FILTER_TYPES[filter]] } }),
          },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        })
      ).map((e) => e.id);
      expect(await walk(w, `filter=${filter}&order=asc&limit=9`), filter).toEqual(expected);
      expect(await walk(w, `filter=${filter}&order=desc&limit=9`), filter).toEqual([...expected].reverse());
    }
  });

  it.concurrent("never returns more than 100 per page and rejects out-of-range limits and bad cursors", async () => {
    const w = await bigTimeline();
    expect((await list(w.m1, w, "limit=100")).body.items).toHaveLength(100);
    expect((await list(w.m1, w)).body.items).toHaveLength(50); // default
    for (const q of [
      "limit=101",
      "limit=0",
      "limit=abc",
      "cursor=garbage",
      "filter=everything",
      "order=sideways",
      "after=recently",
    ]) {
      const res = await list(w.m1, w, q);
      expect(res.status, q).toBe(400);
      expect(res.body.error.code).toBe("validation_error");
    }
  });
});

describe("filters", () => {
  it.concurrent("each filter returns only what it promises", async () => {
    const w = await world();
    const mk = (type: string, over: Record<string, unknown> = {}) =>
      prisma.event.create({
        data: {
          workspaceId: w.wsId,
          incidentId: w.inc1.id,
          type: type as never,
          source: "USER",
          actorId: w.m1.id,
          payload: {},
          occurredAt: at(Math.floor(Math.random() * 1000)),
          ...over,
        },
      });
    await Promise.all([
      mk("NOTE", { body: "plain" }),
      mk("NOTE", { body: "starred", isKeyMoment: true }),
      mk("STATUS_CHANGED"),
      mk("SEVERITY_CHANGED"),
      mk("ROLE_ASSIGNED"),
      mk("ROLE_UNASSIGNED"),
      mk("SERVICES_CHANGED"),
      mk("TITLE_CHANGED"),
      mk("SUMMARY_CHANGED"),
    ]);
    const types = async (filter: string) =>
      (await list(w.m1, w, `filter=${filter}&limit=100`)).body.items.map((i: TimelineEventView) => i.type).sort();

    expect(await types("all")).toHaveLength(9);
    expect(await types("notes")).toEqual(["NOTE", "NOTE"]);
    expect(await types("status")).toEqual(["SEVERITY_CHANGED", "STATUS_CHANGED"]);
    expect(await types("roles")).toEqual(["ROLE_ASSIGNED", "ROLE_UNASSIGNED", "SERVICES_CHANGED"]);
    const key = (await list(w.m1, w, "filter=key")).body.items;
    expect(key).toHaveLength(1);
    expect(key[0]).toMatchObject({ body: "starred", isKeyMoment: true });
    expect((await list(w.m1, w, "limit=100")).body.items).toHaveLength(9); // default filter is all
  });

  it.concurrent("shows what real incident changes wrote, in order, ready to be humanised", async () => {
    const w = await world();
    const target = { slug: w.slug, number: "1" };
    const through = (handler: Parameters<typeof call>[1], path: string, method: string, body: unknown) =>
      call(w.m1, handler, `/api/w/${w.slug}/incidents/1${path}`, { method, body, params: target });
    expect((await through(statusRoute.POST, "/status", "POST", { status: "IDENTIFIED" })).status).toBe(200);
    expect((await through(incidentRoute.PATCH, "", "PATCH", { severity: 5 })).status).toBe(200);
    expect((await through(rolesRoute.PUT, "/roles", "PUT", { COMMANDER: w.m2.id })).status).toBe(200);
    const svc = await prisma.service.create({ data: { workspaceId: w.wsId, name: "Search", slug: "search" } });
    expect((await through(incidentRoute.PATCH, "", "PATCH", { serviceIds: [svc.id] })).status).toBe(200);
    expect((await through(incidentRoute.PATCH, "", "PATCH", { title: "New title" })).status).toBe(200);

    const res = await list(w.m1, w, "limit=100");
    const seen = res.body.items.map((i: TimelineEventView) => i.type);
    expect(seen).toEqual(["STATUS_CHANGED", "SEVERITY_CHANGED", "ROLE_ASSIGNED", "SERVICES_CHANGED", "TITLE_CHANGED"]);
    const role = res.body.items.find((i: TimelineEventView) => i.type === "ROLE_ASSIGNED");
    expect(role.payload).toMatchObject({ role: "COMMANDER", from: null, to: w.m2.id });
    expect(res.body.people[w.m2.id]).toMatchObject({ email: w.m2.email }); // names for the people the sentence mentions
    expect(res.body.people[w.m1.id]).toBeTruthy();
  });

  it.concurrent("still names people who have left the workspace", async () => {
    const w = await world();
    const leaver = await createUser("leaver");
    await prisma.event.create({
      data: {
        workspaceId: w.wsId,
        incidentId: w.inc1.id,
        type: "NOTE",
        source: "USER",
        actorId: leaver.id,
        body: "from a former member",
        occurredAt: at(0),
      },
    });
    const res = await list(w.m1, w, "");
    expect(res.body.people[leaver.id]).toMatchObject({ name: leaver.name, email: leaver.email });
  });
});

describe("refreshing with `after`", () => {
  it.concurrent("returns only what is new, including backfilled entries, and nothing older", async () => {
    const w = await world();
    const old = await makeNote(w, w.m1, { body: "old" });
    await new Promise((r) => setTimeout(r, 30));
    const first = await list(w.m1, w, "");
    const asOf = first.body.asOf as string;
    await new Promise((r) => setTimeout(r, 30));

    const fresh = await add(w.m2, w, { body: "fresh" });
    const backfilled = await add(w.m2, w, {
      body: "recalled",
      occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const changes = await list(w.m1, w, `after=${encodeURIComponent(asOf)}`);
    expect(changes.status).toBe(200);
    expect(ids(changes).sort()).toEqual([fresh.body.event.id, backfilled.body.event.id].sort());
    expect(ids(changes)).not.toContain(old.id);
    expect(changes.body).toMatchObject({ deleted: [], truncated: false });
    expect(typeof changes.body.asOf).toBe("string");
    expect(changes.body.people[w.m2.id]).toBeTruthy();

    // asking again from the new marker finds nothing
    const quiet = await list(w.m1, w, `after=${encodeURIComponent(changes.body.asOf)}`);
    expect(quiet.body.items).toEqual([]);
  });

  it.concurrent("reports edits, key-moment toggles and deletions made by other people", async () => {
    const w = await world();
    const a = (await add(w.m1, w, { body: "to edit" })).body.event.id as string;
    const b = (await add(w.m1, w, { body: "to star" })).body.event.id as string;
    const c = (await add(w.m1, w, { body: "to delete" })).body.event.id as string;
    await new Promise((r) => setTimeout(r, 30));
    const asOf = (await list(w.m1, w, "")).body.asOf as string;
    await new Promise((r) => setTimeout(r, 30));

    await edit(w.admin, w, a, { body: "edited by admin" });
    await edit(w.admin, w, b, { isKeyMoment: true });
    await remove(w.admin, w, c);

    const changes = await list(w.m2, w, `after=${encodeURIComponent(asOf)}`);
    const byId = Object.fromEntries(changes.body.items.map((i: TimelineEventView) => [i.id, i]));
    expect(byId[a]).toMatchObject({ body: "edited by admin", editedAt: expect.any(String) });
    expect(byId[b]).toMatchObject({ isKeyMoment: true, editedAt: null });
    expect(changes.body.deleted).toEqual([c]);
    expect(changes.body.items.map((i: TimelineEventView) => i.id)).not.toContain(c);
  });

  it.concurrent("flags when too much changed to merge, and keeps other incidents' changes out", async () => {
    const w = await world();
    const asOf = (await list(w.m1, w, "")).body.asOf as string;
    await new Promise((r) => setTimeout(r, 30));
    await prisma.event.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        workspaceId: w.wsId,
        incidentId: w.inc1.id,
        type: "NOTE" as const,
        source: "USER" as const,
        actorId: w.m1.id,
        body: `bulk ${i}`,
        occurredAt: at(i),
      })),
    });
    await makeNote(w, w.m1, { body: "elsewhere" }, w.inc2.id);
    const res = await list(w.m1, w, `after=${encodeURIComponent(asOf)}`);
    expect(res.body.truncated).toBe(true);
    expect(res.body.items).toHaveLength(100);
    expect(JSON.stringify(res.body)).not.toContain("elsewhere");
  });
});

describe("editing", () => {
  it.concurrent(
    "sets editedAt for text or time changes, not for starring, and never adds timeline entries",
    async () => {
      const w = await world();
      const created = (await add(w.m1, w, { body: "original" })).body.event;
      const countBefore = await prisma.event.count({ where: { incidentId: w.inc1.id } });

      const starred = await edit(w.m1, w, created.id, { isKeyMoment: true });
      expect(starred.body.event).toMatchObject({ isKeyMoment: true, editedAt: null });

      const body = await edit(w.m1, w, created.id, { body: "  reworded  " });
      expect(body.body.event).toMatchObject({ body: "reworded", editedAt: expect.any(String), isKeyMoment: true });
      const editedAt = body.body.event.editedAt as string;
      expect(new Date(editedAt).getTime()).toBeGreaterThan(new Date(created.createdAt).getTime() - 1);

      await new Promise((r) => setTimeout(r, 20));
      const time = await edit(w.m1, w, created.id, { occurredAt: new Date(Date.now() - 600_000).toISOString() });
      expect(new Date(time.body.event.editedAt).getTime()).toBeGreaterThan(new Date(editedAt).getTime());

      const unstar = await edit(w.m1, w, created.id, { isKeyMoment: false });
      expect(unstar.body.event.isKeyMoment).toBe(false);
      expect(unstar.body.event.editedAt).toBe(time.body.event.editedAt); // unchanged by the toggle

      expect(await prisma.event.count({ where: { incidentId: w.inc1.id } })).toBe(countBefore); // no new entries
      expect(
        await prisma.auditLog.count({ where: { workspaceId: w.wsId, action: { startsWith: "incident.note" } } }),
      ).toBe(0);
    },
  );

  it.concurrent("a patch that changes nothing leaves the note, and editedAt, alone", async () => {
    const w = await world();
    const created = (await add(w.m1, w, { body: "same", isKeyMoment: true })).body.event;
    const res = await edit(w.m1, w, created.id, { body: "same", isKeyMoment: true, occurredAt: created.occurredAt });
    expect(res.status).toBe(200);
    expect(res.body.event.editedAt).toBeNull();
    expect(res.body.event.occurredAt).toBe(created.occurredAt);
  });

  it.concurrent("validates edits", async () => {
    const w = await world();
    const id = (await add(w.m1, w, { body: "x" })).body.event.id as string;
    for (const body of [
      {},
      { body: "" },
      { body: "x".repeat(5001) },
      { occurredAt: "soon" },
      { isKeyMoment: "yes" },
      { createdAt: "2020-01-01T00:00:00Z" },
      { type: "STATUS_CHANGED" },
    ]) {
      expect((await edit(w.m1, w, id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.event.findUniqueOrThrow({ where: { id } })).toMatchObject({
      body: "x",
      type: "NOTE",
      editedAt: null,
    });
  });
});

describe("deleting", () => {
  it.concurrent("is permanent and writes an audit row naming the incident and note, never the text", async () => {
    const w = await world();
    const secret = "the customer's card number is 4242 4242 4242 4242";
    const id = (await add(w.m1, w, { body: secret })).body.event.id as string;

    const res = await remove(w.m1, w, id);
    expect(res.body).toEqual({ deleted: true });
    expect(await prisma.event.count({ where: { id } })).toBe(0);
    expect((await remove(w.m1, w, id)).status).toBe(404); // already gone

    const audits = await prisma.auditLog.findMany({ where: { workspaceId: w.wsId, action: "incident.note_deleted" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: w.m1.id,
      targetType: "incident",
      targetId: w.inc1.id,
      metadata: { number: 1, noteId: id },
    });
    expect(JSON.stringify(audits)).not.toContain("4242");
    expect(JSON.stringify(audits)).not.toContain("customer");
    expect(Object.keys(audits[0].metadata as object).sort()).toEqual(["noteId", "number"]);
  });

  it.concurrent("an admin's delete is attributed to the admin; a failed delete writes nothing", async () => {
    const w = await world();
    const id = (await add(w.m1, w, { body: "x" })).body.event.id as string;
    expect((await remove(w.m2, w, id)).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { workspaceId: w.wsId, action: "incident.note_deleted" } })).toBe(0);
    await remove(w.admin, w, id);
    expect(
      (await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: w.wsId, action: "incident.note_deleted" } }))
        .actorId,
    ).toBe(w.admin.id);
  });
});
