import { describe, expect, it, vi } from "vitest";
import * as incidents from "@/app/api/w/[slug]/incidents/route";
import { prisma } from "@/server/db/client";
import { call, type TestUser } from "@/test/api";
import { addMember, createTeam } from "@/test/fixtures";

vi.mock("@/server/auth/session", async () => {
  const { currentTestUser } = await import("@/test/api");
  return { getSession: async () => (currentTestUser() ? { user: currentTestUser(), session: {} } : null) };
});

const STATUSES = ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"] as const;
const DAY = 86_400_000;

/** `count` incidents with deliberately many ties: 6 distinct start times, 5 severities, 4 statuses. */
async function seededWorkspace(count = 60) {
  const t = await createTeam("page");
  const member = await addMember(t.workspace.id, "MEMBER");
  const base = Date.UTC(2026, 0, 1);
  await prisma.incident.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      workspaceId: t.workspace.id,
      number: i + 1,
      title: `Incident ${i + 1}`,
      severity: (i % 5) + 1,
      status: STATUSES[i % 4],
      startedAt: new Date(base + (i % 6) * DAY),
      createdById: t.owner.id,
    })),
  });
  await prisma.workspace.update({ where: { id: t.workspace.id }, data: { nextIncidentNumber: count + 1 } });
  return { ...t, member, slug: t.workspace.slug, count };
}
type W = Awaited<ReturnType<typeof seededWorkspace>>;

const get = (user: TestUser, w: Pick<W, "slug">, query = "") =>
  call(user, incidents.GET, `/api/w/${w.slug}/incidents${query ? `?${query}` : ""}`, { params: { slug: w.slug } });

/** Follow `nextCursor` to the end, returning each page's incident numbers. */
async function pages(user: TestUser, w: W, query: string): Promise<number[][]> {
  const out: number[][] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const res: Awaited<ReturnType<typeof get>> = await get(user, w, `${query}${cursor ? `&cursor=${cursor}` : ""}`);
    expect(res.status).toBe(200);
    out.push(res.body.items.map((i: { number: number }) => i.number));
    cursor = res.body.nextCursor;
    if (!cursor) return out;
  }
  throw new Error("pagination did not terminate");
}

describe("GET /incidents", () => {
  it.concurrent("is 404 for non-members and 401 signed out", async () => {
    const w = await seededWorkspace(3);
    const stranger = (await createTeam("page-other")).owner;
    expect((await get(stranger, w)).status).toBe(404);
    expect((await get(null, w)).status).toBe(401);
    expect((await get(w.member, w)).status).toBe(200); // any member can list
  });

  it.concurrent("pages 25 at a time by default, then the remainder", async () => {
    const w = await seededWorkspace();
    const all = await pages(w.member, w, "open=0");
    expect(all.map((p) => p.length)).toEqual([25, 25, 10]);
    const flat = all.flat();
    expect(new Set(flat).size).toBe(60);
    expect(flat.sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it.concurrent("honours limit (1-100) and reports no cursor on the last page", async () => {
    const w = await seededWorkspace();
    expect((await pages(w.member, w, "open=0&limit=7")).map((p) => p.length)).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 4]);
    expect((await get(w.member, w, "open=0&limit=100")).body.items).toHaveLength(60);
    const exact = await get(w.member, w, "open=0&limit=60");
    expect(exact.body.items).toHaveLength(60);
    expect(exact.body.nextCursor).toBeNull(); // a full page that is also the last one has no phantom next page
    const one = await get(w.member, w, "open=0&limit=1");
    expect(one.body.items).toHaveLength(1);
    expect(one.body.nextCursor).toBe(one.body.items[0].id);
  });

  for (const sort of ["started", "severity", "status", "number"]) {
    for (const dir of ["asc", "desc"]) {
      it.concurrent(`every row exactly once with ties: sort=${sort} dir=${dir}`, async () => {
        const w = await seededWorkspace();
        const paged = await pages(w.member, w, `open=0&sort=${sort}&dir=${dir}`);
        const flat = paged.flat();
        expect(flat).toHaveLength(60);
        expect(new Set(flat).size).toBe(60); // no overlap between pages, no repeats
        // and the paged order is exactly the unpaged order (no skipped or reordered rows)
        const whole = await get(w.member, w, `open=0&sort=${sort}&dir=${dir}&limit=100`);
        expect(flat).toEqual(whole.body.items.map((i: { number: number }) => i.number));
      });
    }
  }

  it.concurrent("keeps pages complete when filters apply and rows were soft-deleted", async () => {
    const w = await seededWorkspace();
    // soft-delete every 7th incident
    await prisma.incident.updateMany({
      where: { workspaceId: w.workspace.id, number: { in: Array.from({ length: 8 }, (_, i) => (i + 1) * 7) } },
      data: { deletedAt: new Date() },
    });
    const flat = (await pages(w.member, w, "open=0&limit=10&sort=severity")).flat();
    expect(flat).toHaveLength(52);
    expect(flat.some((n) => n % 7 === 0 && n <= 56)).toBe(false);

    const filtered = (await pages(w.member, w, "status=RESOLVED,MITIGATING&severity=1,2,3&limit=4")).flat();
    const expected = await prisma.incident.count({
      where: {
        workspaceId: w.workspace.id,
        deletedAt: null,
        status: { in: ["RESOLVED", "MITIGATING"] },
        severity: { in: [1, 2, 3] },
      },
    });
    expect(filtered).toHaveLength(expected);
    expect(new Set(filtered).size).toBe(expected);
  });

  it.concurrent("rejects invalid query values with field errors (the page is lenient, the API is not)", async () => {
    const w = await seededWorkspace(3);
    for (const [query, field] of [
      ["status=DONE", "status"],
      ["severity=9", "severity"],
      ["from=2026-02-30", "from"],
      ["to=soon", "to"],
      ["open=maybe", "open"],
      ["sort=color", "sort"],
      ["dir=sideways", "dir"],
      ["limit=0", "limit"],
      ["limit=101", "limit"],
      ["limit=abc", "limit"],
      [`q=${"x".repeat(101)}`, "q"],
    ] as const) {
      const res = await get(w.member, w, query);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe("validation_error");
      expect(res.body.error.fieldErrors[field], query).toBeTruthy();
    }
  });

  it.concurrent("filters, searches and sorts through the route", async () => {
    const w = await seededWorkspace();
    const sev5 = await get(w.member, w, "open=0&severity=5&limit=100");
    expect(sev5.body.items.every((i: { severity: number }) => i.severity === 5)).toBe(true);
    expect(sev5.body.items).toHaveLength(12);

    const byNumber = await get(w.member, w, "open=0&q=INC-42");
    expect(byNumber.body.items.map((i: { number: number }) => i.number)).toEqual([42]);

    const open = await get(w.member, w, "limit=100"); // open-only is the default
    expect(open.body.items.every((i: { status: string }) => i.status !== "RESOLVED")).toBe(true);
    expect(open.body.items).toHaveLength(45);

    const range = await get(w.member, w, "open=0&from=2026-01-02&to=2026-01-03&limit=100");
    expect(range.body.items).toHaveLength(20); // two of the six start days
    const sorted = await get(w.member, w, "open=0&sort=number&dir=asc&limit=5");
    expect(sorted.body.items.map((i: { number: number }) => i.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it.concurrent("never returns another workspace's rows, even for a foreign cursor", async () => {
    const mine = await seededWorkspace(30);
    const theirs = await seededWorkspace(30);
    const theirFirst = await get(theirs.member, theirs, "open=0&limit=5");
    const res = await get(mine.member, mine, `open=0&limit=100&cursor=${theirFirst.body.nextCursor}`);
    const ids = new Set(
      (await prisma.incident.findMany({ where: { workspaceId: mine.workspace.id }, select: { id: true } })).map(
        (r) => r.id,
      ),
    );
    expect(res.body.items.every((i: { id: string }) => ids.has(i.id))).toBe(true);
  });
});
