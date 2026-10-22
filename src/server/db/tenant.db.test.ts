import { beforeAll, describe, expect, it } from "vitest";
import { createTenant, type Tenant } from "@/test/fixtures";
import { prisma } from "./client";
import { TenantScopeError, scopedDb } from "./tenant";
import { TENANT_MODELS } from "./tenant-models";

let a: Tenant;
let b: Tenant;
let dbB: ReturnType<typeof scopedDb>;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("alpha"), createTenant("beta")]);
  dbB = scopedDb(b.workspace.id);
});

/** How to address tenant A's row in each model: unique where, flat filter, and a harmful update. */
const spec = (t: Tenant) => ({
  membership: { unique: { id: t.membership.id }, filter: { id: t.membership.id }, data: { role: "ADMIN" } },
  invite: { unique: { id: t.invite.id }, filter: { id: t.invite.id }, data: { role: "ADMIN" } },
  service: { unique: { id: t.service.id }, filter: { id: t.service.id }, data: { name: "renamed" } },
  incident: { unique: { id: t.incident.id }, filter: { id: t.incident.id }, data: { title: "hijacked" } },
  incidentService: {
    unique: { incidentId_serviceId: { incidentId: t.incident.id, serviceId: t.service.id } },
    filter: { incidentId: t.incident.id, serviceId: t.service.id },
    data: { serviceId: t.service.id },
  },
  incidentAssignment: { unique: { id: t.assignment.id }, filter: { id: t.assignment.id }, data: { role: "SCRIBE" } },
  event: { unique: { id: t.event.id }, filter: { id: t.event.id }, data: { body: "hijacked" } },
  integration: { unique: { id: t.integration.id }, filter: { id: t.integration.id }, data: { kind: "hijacked" } },
  postmortem: { unique: { id: t.postmortem.id }, filter: { id: t.postmortem.id }, data: { status: "PUBLISHED" } },
  postmortemSection: { unique: { id: t.section.id }, filter: { id: t.section.id }, data: { position: 9 } },
  actionItem: { unique: { id: t.ritual.id }, filter: { id: t.ritual.id }, data: { title: "hijacked" } },
  retroRule: { unique: { id: t.retroRule.id }, filter: { id: t.retroRule.id }, data: { minSeverity: 1 } },
  postmortemTemplate: { unique: { id: t.template.id }, filter: { id: t.template.id }, data: { name: "hijacked" } },
  auditLog: { unique: { id: t.audit.id }, filter: { id: t.audit.id }, data: { action: "hijacked" } },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delegate = (db: any, name: string) => db[name];

const NAMES = [
  "membership", "invite", "service", "incident", "incidentService", "incidentAssignment",
  "event", "integration", "postmortem", "postmortemSection", "actionItem", "retroRule",
  "postmortemTemplate", "auditLog",
] as const;

describe("coverage", () => {
  it("tests every model in the tenant registry", () => {
    const names = NAMES.map((n) => n[0].toUpperCase() + n.slice(1)).sort();
    expect(names).toEqual([...TENANT_MODELS].sort());
  });
});

describe("a workspace-scoped client cannot touch another workspace's rows", () => {
  // Read-only against both tenants, so safe to run concurrently (each hits a remote DB).
  it.concurrent.each(NAMES)("%s", async (name) => {
    const { unique, filter, data } = spec(a)[name];
    const model = delegate(dbB, name);
    const ownCount = await delegate(prisma, name).count({ where: { workspaceId: b.workspace.id } });
    const aBefore = await delegate(prisma, name).findMany({ where: { workspaceId: a.workspace.id } });
    expect(aBefore.length).toBeGreaterThan(0);

    // reads never see A
    expect(await model.findUnique({ where: unique })).toBeNull();
    await expect(model.findUniqueOrThrow({ where: unique })).rejects.toThrow();
    expect(await model.findFirst({ where: filter })).toBeNull();
    expect(await model.count({ where: filter })).toBe(0);
    const visible = await model.findMany();
    expect(visible).toHaveLength(ownCount);
    expect(visible.every((r: { workspaceId: string }) => r.workspaceId === b.workspace.id)).toBe(true);

    // writes aimed at A's row fail or affect nothing
    await expect(model.update({ where: unique, data })).rejects.toThrow();
    await expect(model.delete({ where: unique })).rejects.toThrow();
    expect((await model.updateMany({ where: filter, data })).count).toBe(0);
    expect((await model.deleteMany({ where: filter })).count).toBe(0);

    // naming A's workspace is rejected loudly rather than returning empty
    await expect(model.findMany({ where: { workspaceId: a.workspace.id } })).rejects.toThrow(TenantScopeError);
    await expect(model.deleteMany({ where: { workspaceId: a.workspace.id } })).rejects.toThrow(TenantScopeError);
    await expect(model.create({ data: { workspaceId: a.workspace.id } })).rejects.toThrow(TenantScopeError);

    // and A's rows are untouched
    const aAfter = await delegate(prisma, name).findMany({ where: { workspaceId: a.workspace.id } });
    expect(JSON.stringify(aAfter)).toBe(JSON.stringify(aBefore));
  });
});

describe("scoped client behaviour", () => {
  it("deleteMany with no filter only deletes the scoped workspace's rows", async () => {
    const x = await createTenant("gamma");
    const y = await createTenant("delta");
    const before = await prisma.integration.count({ where: { workspaceId: y.workspace.id } });
    await scopedDb(x.workspace.id).integration.deleteMany();
    expect(await prisma.integration.count({ where: { workspaceId: x.workspace.id } })).toBe(0);
    expect(await prisma.integration.count({ where: { workspaceId: y.workspace.id } })).toBe(before);
  });

  it("creates through the scoped client land in its workspace", async () => {
    const svc = await dbB.service.create({ data: { workspaceId: dbB.$workspaceId, name: `auto-${Date.now()}`, slug: `auto-${Date.now()}` } });
    expect(svc.workspaceId).toBe(b.workspace.id);
  });

  it("scopes the Workspace root and forbids creating workspaces", async () => {
    expect((await dbB.workspace.findMany()).map((w) => w.id)).toEqual([b.workspace.id]);
    await expect(dbB.workspace.findUnique({ where: { id: a.workspace.id } })).rejects.toThrow(TenantScopeError);
    expect(await dbB.workspace.findUnique({ where: { slug: a.workspace.slug } })).toBeNull();
    await expect(dbB.workspace.update({ where: { id: a.workspace.id }, data: { name: "x" } })).rejects.toThrow(TenantScopeError);
    await expect(dbB.workspace.update({ where: { slug: a.workspace.slug }, data: { name: "x" } })).rejects.toThrow();
    await expect(dbB.workspace.create({ data: { name: "x", slug: "x-evil" } })).rejects.toThrow(TenantScopeError);
  });

  it("makes auth tables unreachable", async () => {
    for (const m of ["user", "session", "account", "verification"]) {
      await expect(delegate(dbB, m).findMany()).rejects.toThrow(TenantScopeError);
    }
  });

  it("stays scoped inside interactive transactions", async () => {
    const ids = await dbB.$transaction(async (tx) => (await tx.incident.findMany()).map((i) => i.workspaceId));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set([b.workspace.id]));
  });

  it("a tenant can still read and edit its own data", async () => {
    const dbA = scopedDb(a.workspace.id);
    const updated = await dbA.incident.update({ where: { id: a.incident.id }, data: { summary: "mine" } });
    expect(updated.summary).toBe("mine");
  });
});

describe("the database itself rejects cross-tenant references", () => {
  it("event pointing at another workspace's incident", async () => {
    await expect(dbB.event.create({ data: { workspaceId: b.workspace.id, incidentId: a.incident.id, type: "NOTE" } })).rejects.toThrow();
  });

  it("incident linked to another workspace's service", async () => {
    await expect(
      dbB.incidentService.create({ data: { workspaceId: b.workspace.id, incidentId: b.incident.id, serviceId: a.service.id } }),
    ).rejects.toThrow();
  });

  it("role assigned to a non-member", async () => {
    await expect(
      dbB.incidentAssignment.create({ data: { workspaceId: b.workspace.id, incidentId: b.incident.id, userId: a.owner.id, role: "SCRIBE" } }),
    ).rejects.toThrow();
  });

  it("section attached to another workspace's postmortem", async () => {
    await expect(
      dbB.postmortemSection.create({
        data: { workspaceId: b.workspace.id, postmortemId: a.postmortem.id, key: "LEARNED", content: {}, position: 1 },
      }),
    ).rejects.toThrow();
  });
});
