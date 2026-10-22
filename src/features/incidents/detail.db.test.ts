import { describe, expect, it, vi } from "vitest";
import * as incidentRoute from "@/app/api/w/[slug]/incidents/[number]/route";
import * as rolesRoute from "@/app/api/w/[slug]/incidents/[number]/roles/route";
import * as statusRoute from "@/app/api/w/[slug]/incidents/[number]/status/route";
import { listServices } from "@/features/services/service";
import { prisma } from "@/server/db/client";
import { scopedDb } from "@/server/db/tenant";
import { call, type TestUser } from "@/test/api";
import { addMember, createTeam, createUser } from "@/test/fixtures";
import { getIncidentByNumber, listIncidents } from "./list";
import { parseListParams } from "./list-params";

vi.mock("@/server/auth/session", async () => {
  const { currentTestUser } = await import("@/test/api");
  return { getSession: async () => (currentTestUser() ? { user: currentTestUser(), session: {} } : null) };
});

/** Workspace A (owner, admin, two members, two services, incident #1) and workspace B with its own incident #1. */
async function world() {
  const a = await createTeam("det-a");
  const admin = await addMember(a.workspace.id, "ADMIN");
  const member = await addMember(a.workspace.id, "MEMBER");
  const other = await addMember(a.workspace.id, "MEMBER");
  const b = await createTeam("det-b");
  const svc = (workspaceId: string, name: string) =>
    prisma.service.create({ data: { workspaceId, name, slug: name.toLowerCase() } });
  const [api, db] = [await svc(a.workspace.id, "API"), await svc(a.workspace.id, "DB")];
  const mk = (workspaceId: string, createdById: string, over: object = {}) =>
    prisma.incident.create({
      data: {
        workspaceId,
        number: 1,
        title: "Original title",
        summary: "Original summary",
        severity: 3,
        createdById,
        ...over,
      },
    });
  const incA = await mk(a.workspace.id, a.owner.id, { services: { create: { serviceId: api.id } } });
  const incB = await mk(b.workspace.id, b.owner.id, { title: "B's incident" });
  return { a, b, admin, member, other, api, db, incA, incB, slug: a.workspace.slug, bSlug: b.workspace.slug };
}

const P = (slug: string, n: number | string = 1) => `/api/w/${slug}/incidents/${n}`;
const get = (user: TestUser, slug: string, n: number | string = 1) =>
  call(user, incidentRoute.GET, P(slug, n), { params: { slug, number: String(n) } });
const patch = (user: TestUser, slug: string, body: unknown, n: number | string = 1) =>
  call(user, incidentRoute.PATCH, P(slug, n), { method: "PATCH", body, params: { slug, number: String(n) } });
const del = (user: TestUser, slug: string, n: number | string = 1) =>
  call(user, incidentRoute.DELETE, P(slug, n), { method: "DELETE", params: { slug, number: String(n) } });
const status = (user: TestUser, slug: string, body: unknown, n: number | string = 1) =>
  call(user, statusRoute.POST, `${P(slug, n)}/status`, { method: "POST", body, params: { slug, number: String(n) } });
const roles = (user: TestUser, slug: string, body: unknown, n: number | string = 1) =>
  call(user, rolesRoute.PUT, `${P(slug, n)}/roles`, { method: "PUT", body, params: { slug, number: String(n) } });

const events = (incidentId: string, type?: string) =>
  prisma.event.findMany({
    where: { incidentId, ...(type ? { type: type as never } : {}) },
    orderBy: { createdAt: "asc" },
  });
const audits = (workspaceId: string, action: string) => prisma.auditLog.findMany({ where: { workspaceId, action } });

describe("isolation", () => {
  it.concurrent("non-members get 404 (signed-out 401) on every incident route and nothing changes", async () => {
    const w = await world();
    const calls: [string, (u: TestUser) => ReturnType<typeof call>][] = [
      ["GET", (u) => get(u, w.slug)],
      ["PATCH", (u) => patch(u, w.slug, { title: "Hacked" })],
      ["status", (u) => status(u, w.slug, { status: "RESOLVED" })],
      ["roles", (u) => roles(u, w.slug, { COMMANDER: w.b.owner.id })],
      ["DELETE", (u) => del(u, w.slug)],
    ];
    for (const [label, run] of calls) {
      const res = await run(w.b.owner);
      expect(res.status, label).toBe(404);
      expect(res.body.error.code).toBe("not_found");
      expect((await run(null)).status, `${label} signed out`).toBe(401);
    }
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } });
    expect(row).toMatchObject({ title: "Original title", status: "INVESTIGATING", deletedAt: null });
    expect(await events(w.incA.id)).toHaveLength(0);
  });

  it.concurrent("the same incident number in two workspaces never crosses over", async () => {
    const w = await world();
    // B's owner edits B's #1 through B's slug: only B's row changes
    expect((await patch(w.b.owner, w.bSlug, { title: "B renamed" })).status).toBe(200);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: w.incB.id } })).title).toBe("B renamed");
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } })).title).toBe("Original title");
    // A's owner reading #1 through A's slug sees A's incident, and cannot reach B's through B's slug
    expect((await get(w.a.owner, w.slug)).body.incident.title).toBe("Original title");
    expect((await get(w.a.owner, w.bSlug)).status).toBe(404);
    expect((await del(w.a.owner, w.bSlug)).status).toBe(404);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: w.incB.id } })).deletedAt).toBeNull();
    // a number that only exists in the other workspace is a 404 here
    await prisma.incident.create({
      data: { workspaceId: w.b.workspace.id, number: 2, title: "B only", severity: 1, createdById: w.b.owner.id },
    });
    expect((await get(w.a.owner, w.slug, 2)).status).toBe(404);
  });

  it.concurrent("rejects malformed numbers and unknown incidents with 404", async () => {
    const w = await world();
    for (const n of ["abc", "0x1", "-1", "1.5", "99999999999", "42"]) {
      const res = await get(w.member, w.slug, n);
      expect(res.status, n).toBe(404);
    }
  });
});

describe("reading", () => {
  it.concurrent("returns the incident with services, roles and creator", async () => {
    const w = await world();
    await prisma.incidentAssignment.create({
      data: { workspaceId: w.a.workspace.id, incidentId: w.incA.id, userId: w.member.id, role: "SCRIBE" },
    });
    const res = await get(w.other, w.slug);
    expect(res.status).toBe(200);
    expect(res.body.incident).toMatchObject({
      number: 1,
      title: "Original title",
      summary: "Original summary",
      severity: 3,
      status: "INVESTIGATING",
      resolvedAt: null,
      services: [{ id: w.api.id, name: "API" }],
      createdBy: { email: w.a.owner.email },
      roles: { COMMANDER: null, COMMS: null, SCRIBE: { userId: w.member.id, email: w.member.email } },
    });
  });
});

describe("editing", () => {
  it.concurrent("title, summary and severity each write an event with the actor and from/to", async () => {
    const w = await world();
    const res = await patch(w.member, w.slug, { title: "  New title  ", summary: " New summary ", severity: 5 });
    expect(res.status).toBe(200);
    expect(res.body.incident).toMatchObject({ title: "New title", summary: "New summary", severity: 5 });

    const byType = Object.fromEntries((await events(w.incA.id)).map((e) => [e.type, e]));
    expect(byType.TITLE_CHANGED).toMatchObject({
      actorId: w.member.id,
      source: "USER",
      payload: { from: "Original title", to: "New title" },
    });
    expect(byType.SUMMARY_CHANGED.payload).toMatchObject({
      from: "Original summary",
      to: "New summary",
      truncated: false,
    });
    expect(byType.SEVERITY_CHANGED).toMatchObject({ actorId: w.member.id, payload: { from: 3, to: 5 } });
    expect(await events(w.incA.id)).toHaveLength(3);

    expect(await audits(w.a.workspace.id, "incident.severity_changed")).toEqual([
      expect.objectContaining({ actorId: w.member.id, targetId: w.incA.id, metadata: { number: 1, from: 3, to: 5 } }),
    ]);
  });

  it.concurrent("changing nothing writes nothing", async () => {
    const w = await world();
    const res = await patch(w.member, w.slug, {
      title: "Original title",
      summary: "Original summary",
      severity: 3,
      serviceIds: [w.api.id],
    });
    expect(res.status).toBe(200);
    expect(await events(w.incA.id)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { workspaceId: w.a.workspace.id } })).toBe(0);
  });

  it.concurrent("clipped summaries are flagged in the event; the incident keeps the full text", async () => {
    const w = await world();
    const long = "x".repeat(5000);
    expect((await patch(w.member, w.slug, { summary: long })).status).toBe(200);
    const [ev] = await events(w.incA.id, "SUMMARY_CHANGED");
    expect((ev.payload as { to: string; truncated: boolean }).to).toHaveLength(2000);
    expect((ev.payload as { truncated: boolean }).truncated).toBe(true);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } })).summary).toHaveLength(5000);
  });

  it.concurrent("services: adds and removes links and records which by name", async () => {
    const w = await world();
    const res = await patch(w.member, w.slug, { serviceIds: [w.db.id] }); // API -> DB
    expect(res.body.incident.services).toEqual([{ id: w.db.id, name: "DB" }]);
    const [ev] = await events(w.incA.id, "SERVICES_CHANGED");
    expect(ev).toMatchObject({
      actorId: w.member.id,
      payload: { from: ["API"], to: ["DB"], added: ["DB"], removed: ["API"] },
    });
    expect(await prisma.incidentService.count({ where: { incidentId: w.incA.id } })).toBe(1);

    expect((await patch(w.member, w.slug, { serviceIds: [] })).body.incident.services).toEqual([]);
    expect(
      (await patch(w.member, w.slug, { serviceIds: [w.api.id, w.db.id, w.api.id] })).body.incident.services,
    ).toHaveLength(2);
    expect(await events(w.incA.id, "SERVICES_CHANGED")).toHaveLength(3);
  });

  it.concurrent("an invalid service rolls back the whole edit", async () => {
    const w = await world();
    const foreign = await prisma.service.create({
      data: { workspaceId: w.b.workspace.id, name: "Theirs", slug: "theirs" },
    });
    for (const serviceIds of [["nope"], [foreign.id], [w.api.id, foreign.id]]) {
      const res = await patch(w.member, w.slug, { title: "Should not stick", serviceIds });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: "invalid_service",
        fieldErrors: { serviceIds: ["invalid_service"] },
      });
    }
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } })).title).toBe("Original title");
    expect(await events(w.incA.id)).toHaveLength(0);
    expect(await prisma.incidentService.count({ where: { serviceId: foreign.id } })).toBe(0);
  });

  it.concurrent("validates the body", async () => {
    const w = await world();
    const bad: [string, unknown][] = [
      ["title", { title: "" }],
      ["title", { title: "x".repeat(141) }],
      ["severity", { severity: 6 }],
      ["severity", { severity: "3" }],
      ["summary", { summary: "s".repeat(20_001) }],
      ["serviceIds", { serviceIds: "api" }],
    ];
    for (const [field, body] of bad) {
      const res = await patch(w.member, w.slug, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(res.body.error.fieldErrors[field]).toBeTruthy();
    }
    // empty bodies and attempts to set protected fields are rejected, not silently ignored
    for (const body of [{}, { resolvedAt: "2020-01-01T00:00:00Z" }, { status: "RESOLVED" }, { number: 9 }]) {
      expect((await patch(w.member, w.slug, body)).status).toBe(400);
    }
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } })).resolvedAt).toBeNull();
    expect(await events(w.incA.id)).toHaveLength(0);
  });
});

describe("status", () => {
  it.concurrent("resolving sets resolvedAt, reopening clears it, resolving again sets a new one", async () => {
    const w = await world();
    const stamp = async () => (await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } })).resolvedAt;

    const before = Date.now();
    const r1 = await status(w.member, w.slug, { status: "RESOLVED" });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ changed: true, incident: { status: "RESOLVED" } });
    const first = (await stamp())!;
    expect(first.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(r1.body.incident.resolvedAt).toBe(first.toISOString());

    const reopened = await status(w.member, w.slug, { status: "INVESTIGATING" });
    expect(reopened.body.incident).toMatchObject({ status: "INVESTIGATING", resolvedAt: null });
    expect(await stamp()).toBeNull();

    await new Promise((r) => setTimeout(r, 20));
    const r2 = await status(w.member, w.slug, { status: "RESOLVED" });
    expect(r2.body.incident.resolvedAt).not.toBeNull();
    expect((await stamp())!.getTime()).toBeGreaterThan(first.getTime());

    const evs = await events(w.incA.id, "STATUS_CHANGED");
    expect(evs.map((e) => e.payload)).toEqual([
      { from: "INVESTIGATING", to: "RESOLVED" },
      { from: "RESOLVED", to: "INVESTIGATING" },
      { from: "INVESTIGATING", to: "RESOLVED" },
    ]);
    expect(evs.every((e) => e.actorId === w.member.id && e.source === "USER")).toBe(true);
    expect(await audits(w.a.workspace.id, "incident.status_changed")).toHaveLength(3);
  });

  it.concurrent("moves between open statuses without touching resolvedAt, and same-status is a no-op", async () => {
    const w = await world();
    for (const s of ["IDENTIFIED", "MITIGATING", "INVESTIGATING"]) {
      const res = await status(w.member, w.slug, { status: s });
      expect(res.body.incident).toMatchObject({ status: s, resolvedAt: null });
    }
    const again = await status(w.member, w.slug, { status: "INVESTIGATING" });
    expect(again.status).toBe(200);
    expect(again.body.changed).toBe(false);
    expect(await events(w.incA.id, "STATUS_CHANGED")).toHaveLength(3);

    // resolved -> resolved keeps the original timestamp
    await status(w.member, w.slug, { status: "RESOLVED" });
    const stamped = (await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } })).resolvedAt!;
    await status(w.member, w.slug, { status: "RESOLVED" });
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } })).resolvedAt!.getTime()).toBe(
      stamped.getTime(),
    );
    // resolved -> another open status also clears it
    expect((await status(w.member, w.slug, { status: "MITIGATING" })).body.incident.resolvedAt).toBeNull();
  });

  it.concurrent("rejects unknown statuses", async () => {
    const w = await world();
    for (const body of [{ status: "DONE" }, { status: "resolved" }, {}, { status: 1 }]) {
      expect((await status(w.member, w.slug, body)).status).toBe(400);
    }
    expect(await events(w.incA.id)).toHaveLength(0);
  });
});

describe("roles", () => {
  it.concurrent("assigns, replaces and unassigns, with an event for each change", async () => {
    const w = await world();
    const assign = await roles(w.member, w.slug, { COMMANDER: w.member.id, SCRIBE: w.other.id });
    expect(assign.status).toBe(200);
    expect(assign.body.incident.roles).toMatchObject({
      COMMANDER: { userId: w.member.id },
      SCRIBE: { userId: w.other.id },
      COMMS: null,
    });

    const replace = await roles(w.member, w.slug, { COMMANDER: w.admin.id });
    expect(replace.body.incident.roles.COMMANDER.userId).toBe(w.admin.id);
    expect(replace.body.incident.roles.SCRIBE.userId).toBe(w.other.id); // omitted: untouched

    const unassign = await roles(w.member, w.slug, { SCRIBE: null });
    expect(unassign.body.incident.roles.SCRIBE).toBeNull();

    const evs = await prisma.event.findMany({
      where: { incidentId: w.incA.id, type: { in: ["ROLE_ASSIGNED", "ROLE_UNASSIGNED"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(evs.map((e) => [e.type, e.payload])).toEqual(
      expect.arrayContaining([
        ["ROLE_ASSIGNED", { role: "COMMANDER", from: null, to: w.member.id }],
        ["ROLE_ASSIGNED", { role: "SCRIBE", from: null, to: w.other.id }],
        ["ROLE_ASSIGNED", { role: "COMMANDER", from: w.member.id, to: w.admin.id }],
        ["ROLE_UNASSIGNED", { role: "SCRIBE", from: w.other.id, to: null }],
      ]),
    );
    expect(evs).toHaveLength(4);
    expect(evs.every((e) => e.actorId === w.member.id)).toBe(true);
    expect(await audits(w.a.workspace.id, "incident.role_changed")).toHaveLength(4);
    // one holder per role
    expect(await prisma.incidentAssignment.count({ where: { incidentId: w.incA.id, role: "COMMANDER" } })).toBe(1);
  });

  it.concurrent("the same person can hold several roles, and re-assigning the same person is a no-op", async () => {
    const w = await world();
    await roles(w.member, w.slug, { COMMANDER: w.member.id, SCRIBE: w.member.id, COMMS: w.member.id });
    expect(await prisma.incidentAssignment.count({ where: { incidentId: w.incA.id } })).toBe(3);
    const before = (await events(w.incA.id)).length;
    const again = await roles(w.member, w.slug, { COMMANDER: w.member.id, SCRIBE: null, COMMS: w.member.id });
    expect(again.status).toBe(200);
    expect((await events(w.incA.id)).length).toBe(before + 1); // only the SCRIBE unassignment
    expect(await roles(w.member, w.slug, { SCRIBE: null })).toMatchObject({ status: 200 }); // already empty: nothing
    expect((await events(w.incA.id)).length).toBe(before + 1);
  });

  it.concurrent("rejects people who are not members of this workspace, leaving everything untouched", async () => {
    const w = await world();
    const stranger = await createUser("stranger");
    for (const userId of [w.b.owner.id, stranger.id, "no-such-user"]) {
      const res = await roles(w.member, w.slug, { SCRIBE: w.other.id, COMMANDER: userId });
      expect(res.status, userId).toBe(400);
      expect(res.body.error).toMatchObject({ code: "not_a_member", fieldErrors: { roles: ["not_a_member"] } });
    }
    expect(await prisma.incidentAssignment.count({ where: { incidentId: w.incA.id } })).toBe(0); // SCRIBE rolled back too
    expect(await events(w.incA.id)).toHaveLength(0);
  });

  it.concurrent("rejects someone who left the workspace, and empty or malformed bodies", async () => {
    const w = await world();
    await prisma.membership.deleteMany({ where: { workspaceId: w.a.workspace.id, userId: w.other.id } });
    expect((await roles(w.member, w.slug, { COMMS: w.other.id })).status).toBe(400);
    for (const body of [{}, { COMMANDER: 5 }, { BOSS: w.member.id }, { COMMANDER: "" }]) {
      expect((await roles(w.member, w.slug, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("soft delete", () => {
  it.concurrent("members can't delete; admins and owners can, with an event and an audit row", async () => {
    const w = await world();
    const denied = await del(w.member, w.slug);
    expect(denied.status).toBe(403);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } })).deletedAt).toBeNull();

    const ok = await del(w.admin, w.slug);
    expect(ok.body).toEqual({ deleted: true });
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: w.incA.id } });
    expect(row.deletedAt).not.toBeNull(); // soft: the row is still there
    expect(await events(w.incA.id, "INCIDENT_DELETED")).toEqual([
      expect.objectContaining({ actorId: w.admin.id, payload: { number: 1, title: "Original title" } }),
    ]);
    expect(await audits(w.a.workspace.id, "incident.deleted")).toEqual([
      expect.objectContaining({ actorId: w.admin.id, targetId: w.incA.id }),
    ]);

    const owner = await world();
    expect((await del(owner.a.owner, owner.slug)).status).toBe(200);
  });

  it.concurrent("a deleted incident is gone from every route and every query", async () => {
    const w = await world();
    const db = scopedDb(w.a.workspace.id);
    // a second, live incident that shares the service
    await prisma.incident.create({
      data: {
        workspaceId: w.a.workspace.id,
        number: 2,
        title: "Still here",
        severity: 2,
        createdById: w.a.owner.id,
        services: { create: { serviceId: w.api.id } },
      },
    });
    const before = (await listServices(db)).find((s) => s.id === w.api.id)!;
    expect(before).toMatchObject({ openIncidents: 2, totalIncidents: 2 });

    expect((await del(w.admin, w.slug)).status).toBe(200);

    // routes
    expect((await get(w.member, w.slug)).status).toBe(404);
    expect((await patch(w.member, w.slug, { title: "x" })).status).toBe(404);
    expect((await status(w.member, w.slug, { status: "RESOLVED" })).status).toBe(404);
    expect((await roles(w.member, w.slug, { COMMANDER: w.member.id })).status).toBe(404);
    expect((await del(w.admin, w.slug)).status).toBe(404);
    // queries
    const page = await listIncidents(db, parseListParams({ open: "0" }));
    expect(page.items.map((i) => i.number)).toEqual([2]);
    expect(await getIncidentByNumber(db, 1)).toBeNull();
    expect(await db.incident.count()).toBe(1);
    expect((await db.incident.findMany()).map((i) => i.number)).toEqual([2]);
    expect(await db.incident.findFirst({ where: { number: 1 } })).toBeNull();
    // counts elsewhere
    const after = (await listServices(db)).find((s) => s.id === w.api.id)!;
    expect(after).toMatchObject({ openIncidents: 1, totalIncidents: 1 });
    // search and filters can't resurrect it
    expect((await listIncidents(db, parseListParams({ q: "Original", open: "0" }))).items).toEqual([]);
    expect((await listIncidents(db, parseListParams({ q: "1", open: "0" }))).items).toEqual([]);
    // the raw row survives for audit/history
    expect(await prisma.incident.count({ where: { workspaceId: w.a.workspace.id } })).toBe(2);
  });

  it.concurrent("deleted numbers are not reused", async () => {
    const w = await world();
    await prisma.workspace.update({ where: { id: w.a.workspace.id }, data: { nextIncidentNumber: 2 } });
    await del(w.admin, w.slug);
    const { declareIncident } = await import("./declare");
    const ctx = {
      db: scopedDb(w.a.workspace.id),
      workspace: w.a.workspace,
      membership: { role: "OWNER" } as never,
      user: { id: w.a.owner.id, email: w.a.owner.email, name: "x" },
    };
    const res = await declareIncident(ctx, {
      title: "Next",
      summary: "",
      severity: 1,
      serviceIds: [],
      newServiceNames: [],
      status: "INVESTIGATING",
    });
    expect(res.ok && res.incident.number).toBe(2);
  });

  it.concurrent("deleting a service no longer counts deleted incidents as unlinked", async () => {
    const w = await world();
    await del(w.admin, w.slug);
    const { deleteService } = await import("@/features/services/service");
    const result = await deleteService({ db: scopedDb(w.a.workspace.id) }, w.api.id);
    expect(result).toEqual({ ok: true, unlinkedIncidents: 0 });
  });
});
