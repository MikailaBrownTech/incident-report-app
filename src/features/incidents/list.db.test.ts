import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { scopedDb } from "@/server/db/tenant";
import { addMember, createTeam } from "@/test/fixtures";
import { listIncidents, getIncidentByNumber } from "./list";
import { parseListParams } from "./list-params";

const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12));

/** A workspace with 6 incidents spread over statuses, severities, services and days. */
async function seeded() {
  const t = await createTeam("list");
  const wsId = t.workspace.id;
  const [api, web] = await Promise.all(
    ["API", "Web"].map((name) =>
      prisma.service.create({ data: { workspaceId: wsId, name, slug: name.toLowerCase() } }),
    ),
  );
  const cmd = await addMember(wsId, "ADMIN");
  const rows: [number, string, number, "INVESTIGATING" | "IDENTIFIED" | "MITIGATING" | "RESOLVED", number, string[]][] =
    [
      [1, "Checkout timeouts", 4, "INVESTIGATING", 1, [api.id]],
      [2, "Login page blank", 2, "IDENTIFIED", 2, [web.id]],
      [3, "Search is slow", 3, "MITIGATING", 3, [api.id, web.id]],
      [4, "Payments double charge", 5, "RESOLVED", 4, [api.id]],
      [5, "CHECKOUT button missing", 1, "RESOLVED", 5, []],
      [6, "Emails delayed", 3, "INVESTIGATING", 6, [web.id]],
    ];
  for (const [number, title, severity, status, startDay, serviceIds] of rows) {
    await prisma.incident.create({
      data: {
        workspaceId: wsId,
        number,
        title,
        severity,
        status,
        startedAt: day(startDay),
        createdById: t.owner.id,
        services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
        ...(number === 3 ? { assignments: { create: { userId: cmd.id, role: "COMMANDER" } } } : {}),
      },
    });
  }
  return { t, db: scopedDb(wsId), api, web, cmd, wsId };
}
const numbers = (r: { items: { number: number }[] }) => r.items.map((i) => i.number);
const list = (db: ReturnType<typeof scopedDb>, raw: Record<string, string | string[]>, size?: number) =>
  listIncidents(db, parseListParams(raw), size);

describe("listIncidents", () => {
  it.concurrent("defaults to open incidents, newest first", async () => {
    const { db } = await seeded();
    expect(numbers(await list(db, {}))).toEqual([6, 3, 2, 1]);
  });

  it.concurrent("open=0 shows everything; an explicit status overrides open-only", async () => {
    const { db } = await seeded();
    expect(numbers(await list(db, { open: "0" }))).toEqual([6, 5, 4, 3, 2, 1]);
    expect(numbers(await list(db, { status: "RESOLVED" }))).toEqual([5, 4]); // open-only default does not hide it
    expect(numbers(await list(db, { status: "RESOLVED,MITIGATING" }))).toEqual([5, 4, 3]);
  });

  it.concurrent("filters by severity, service and date range (inclusive days)", async () => {
    const { db, api, web } = await seeded();
    expect(numbers(await list(db, { open: "0", severity: "5,1" }))).toEqual([5, 4]);
    expect(numbers(await list(db, { open: "0", service: api.id }))).toEqual([4, 3, 1]);
    expect(numbers(await list(db, { open: "0", service: `${api.id},${web.id}` }))).toEqual([6, 4, 3, 2, 1]); // any of
    expect(numbers(await list(db, { open: "0", from: "2026-01-02", to: "2026-01-04" }))).toEqual([4, 3, 2]);
    expect(numbers(await list(db, { open: "0", from: "2026-01-05" }))).toEqual([6, 5]);
    expect(numbers(await list(db, { open: "0", to: "2026-01-01" }))).toEqual([1]);
    expect(numbers(await list(db, { open: "0", severity: "3", service: web.id }))).toEqual([6, 3]); // filters AND together
  });

  it.concurrent("searches titles case-insensitively and incident numbers", async () => {
    const { db } = await seeded();
    expect(numbers(await list(db, { open: "0", q: "checkout" }))).toEqual([5, 1]);
    expect(numbers(await list(db, { open: "0", q: "SLOW" }))).toEqual([3]);
    expect(numbers(await list(db, { open: "0", q: "4" }))).toEqual([4]); // number 4 (no title contains "4")
    expect(numbers(await list(db, { open: "0", q: "#2" }))).toEqual([2]);
    expect(numbers(await list(db, { open: "0", q: "INC-6" }))).toEqual([6]);
    expect(numbers(await list(db, { open: "0", q: "Haunting #3" }))).toEqual([3]);
    expect(numbers(await list(db, { open: "0", q: "zzz" }))).toEqual([]);
    // LIKE wildcards in the query are literal text
    expect(numbers(await list(db, { open: "0", q: "%" }))).toEqual([]);
    expect(numbers(await list(db, { open: "0", q: "_" }))).toEqual([]);
  });

  it.concurrent("sorts by started, severity, status and number in both directions", async () => {
    const { db } = await seeded();
    const all = { open: "0" };
    expect(numbers(await list(db, { ...all, sort: "started", dir: "asc" }))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numbers(await list(db, { ...all, sort: "number" }))).toEqual([6, 5, 4, 3, 2, 1]);
    expect(numbers(await list(db, { ...all, sort: "number", dir: "asc" }))).toEqual([1, 2, 3, 4, 5, 6]);
    const bySeverity = await list(db, { ...all, sort: "severity" });
    expect(bySeverity.items.map((i) => i.severity)).toEqual([5, 4, 3, 3, 2, 1]);
    const byStatus = await list(db, { ...all, sort: "status" }); // lifecycle order, open first
    expect(byStatus.items.map((i) => i.status)).toEqual([
      "INVESTIGATING",
      "INVESTIGATING",
      "IDENTIFIED",
      "MITIGATING",
      "RESOLVED",
      "RESOLVED",
    ]);
  });

  it.concurrent("pages with a stable cursor, including across ties", async () => {
    const { db } = await seeded();
    const params = { open: "0", sort: "severity" }; // severity 3 appears twice: ties must not skip or repeat
    const seen: number[] = [];
    let after: string | undefined;
    for (let pageNo = 0; pageNo < 10; pageNo++) {
      const page = await list(db, { ...params, ...(after ? { after } : {}) }, 2);
      seen.push(...numbers(page));
      if (!page.nextCursor) break;
      after = page.nextCursor;
    }
    expect(seen).toEqual(numbers(await list(db, params)));
    expect(new Set(seen).size).toBe(6);

    const last = await list(db, { ...params, after: after! }, 2);
    expect(last.nextCursor).toBeNull();
    const exact = await list(db, params, 6);
    expect(exact.nextCursor).toBeNull(); // exactly one full page: no phantom next page
    expect((await list(db, params, 5)).nextCursor).not.toBeNull();
  });

  it.concurrent("returns services and the commander for each row", async () => {
    const { db, cmd } = await seeded();
    const page = await list(db, { open: "0", sort: "number", dir: "asc" });
    const third = page.items.find((i) => i.number === 3)!;
    expect(third.services.map((s) => s.name)).toEqual(["API", "Web"]);
    expect(third.commander).toMatchObject({ email: cmd.email });
    expect(page.items.find((i) => i.number === 1)!.commander).toBeNull();
    expect(page.items.find((i) => i.number === 5)!.services).toEqual([]);
    expect(typeof third.startedAt).toBe("string");
  });

  it.concurrent("never returns another workspace's incidents, even with its cursor", async () => {
    const mine = await seeded();
    const theirs = await seeded();
    const theirPage = await list(theirs.db, { open: "0" }, 2);
    expect(numbers(await list(mine.db, { open: "0" }))).toEqual([6, 5, 4, 3, 2, 1]);
    const rows = await prisma.incident.findMany({ where: { workspaceId: mine.wsId }, select: { id: true } });
    const foreign = await list(mine.db, { open: "0", after: theirPage.nextCursor! });
    expect(foreign.items.every((i) => rows.some((r) => r.id === i.id))).toBe(true);
    expect(await getIncidentByNumber(mine.db, 3)).toMatchObject({ incident: { number: 3, workspaceId: mine.wsId } });
    expect(await getIncidentByNumber(mine.db, 99)).toBeNull();
  });
});
