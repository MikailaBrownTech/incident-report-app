import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TenantScopeError, scopeArgs } from "./scope";
import { GLOBAL_MODELS, ROOT_MODEL, TENANT_MODELS } from "./tenant-models";

const A = "ws_a";

describe("scopeArgs", () => {
  it("adds the workspace to where for reads and bulk writes", () => {
    for (const op of ["findMany", "findFirst", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]) {
      expect(scopeArgs("Incident", op, { where: { severity: 3 } }, A)).toMatchObject({
        where: { severity: 3, workspaceId: A },
      });
      expect(scopeArgs("Incident", op, undefined, A)).toMatchObject({ where: { workspaceId: A } });
    }
  });

  it("scopes unique lookups, updates and deletes", () => {
    for (const op of ["findUnique", "findUniqueOrThrow", "update", "delete"]) {
      const args = op === "update" ? { where: { id: "x" }, data: { title: "t" } } : { where: { id: "x" } };
      expect(scopeArgs("Incident", op, args, A)).toMatchObject({ where: { id: "x", workspaceId: A } });
    }
  });

  it("stamps workspaceId on create, createMany and upsert", () => {
    expect(scopeArgs("Service", "create", { data: { name: "n" } }, A)).toMatchObject({
      data: { name: "n", workspaceId: A },
    });
    const many = scopeArgs("Service", "createMany", { data: [{ name: "a" }, { name: "b" }] }, A);
    expect(many?.data).toEqual([
      { name: "a", workspaceId: A },
      { name: "b", workspaceId: A },
    ]);
    expect(
      scopeArgs("Service", "upsert", { where: { id: "x" }, create: { name: "n" }, update: { name: "m" } }, A),
    ).toMatchObject({ where: { id: "x", workspaceId: A }, create: { workspaceId: A } });
  });

  it("hides soft-deleted incidents from reads and updates, unless asked explicitly", () => {
    for (const op of ["findMany", "findFirst", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]) {
      expect(scopeArgs("Incident", op, { where: { severity: 3 } }, A)).toMatchObject({
        where: { severity: 3, workspaceId: A, deletedAt: null },
      });
      expect(scopeArgs("Incident", op, undefined, A)).toMatchObject({ where: { workspaceId: A, deletedAt: null } });
    }
    for (const op of ["findUnique", "findUniqueOrThrow", "update", "delete"]) {
      const args = op === "update" ? { where: { id: "x" }, data: { title: "t" } } : { where: { id: "x" } };
      expect(scopeArgs("Incident", op, args, A)).toMatchObject({ where: { id: "x", workspaceId: A, deletedAt: null } });
    }
    expect(scopeArgs("Incident", "upsert", { where: { id: "x" }, create: {}, update: {} }, A)).toMatchObject({
      where: { id: "x", deletedAt: null },
    });
    // explicit deletedAt (a value, or undefined for "any") is respected
    const explicit = new Date();
    expect(scopeArgs("Incident", "findMany", { where: { deletedAt: { not: null } } }, A)).toMatchObject({
      where: { deletedAt: { not: null } },
    });
    expect(scopeArgs("Incident", "findMany", { where: { deletedAt: explicit } }, A)).toMatchObject({ where: { deletedAt: explicit } });
    expect(scopeArgs("Incident", "findMany", { where: { deletedAt: undefined } }, A)?.where).toHaveProperty("deletedAt", undefined);
    // other models and creates are untouched
    expect(scopeArgs("Service", "findMany", {}, A)?.where).not.toHaveProperty("deletedAt");
    expect(scopeArgs("Incident", "create", { data: { title: "t" } }, A)?.data).not.toHaveProperty("deletedAt");
  });

  it("rejects a filter or write that names another workspace", () => {
    expect(() => scopeArgs("Incident", "findMany", { where: { workspaceId: "ws_b" } }, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Incident", "create", { data: { workspaceId: "ws_b" } }, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Incident", "update", { where: { id: "x" }, data: { workspaceId: "ws_b" } }, A)).toThrow(
      TenantScopeError,
    );
    expect(() =>
      scopeArgs("Service", "createMany", { data: [{ name: "a" }, { name: "b", workspaceId: "ws_b" }] }, A),
    ).toThrow(TenantScopeError);
  });

  it("allows an explicit workspaceId that matches", () => {
    expect(() => scopeArgs("Incident", "findMany", { where: { workspaceId: A } }, A)).not.toThrow();
  });

  it("scopes the Workspace root by id and forbids creating one", () => {
    expect(scopeArgs(ROOT_MODEL, "findMany", {}, A)).toMatchObject({ where: { id: A } });
    expect(() => scopeArgs(ROOT_MODEL, "findUnique", { where: { id: "ws_b" } }, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs(ROOT_MODEL, "create", { data: {} }, A)).toThrow(TenantScopeError);
  });

  it("fails closed for global, unregistered and unsupported cases", () => {
    for (const m of GLOBAL_MODELS) expect(() => scopeArgs(m, "findMany", {}, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Mystery", "findMany", {}, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Incident", "findRaw", {}, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Incident", "findMany", {}, "")).toThrow(TenantScopeError);
  });
});

describe("tenant model registry", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
    name: m[1],
    hasWorkspaceId: /^\s+workspaceId\s/m.test(m[2]),
  }));

  it("matches every model that has a workspaceId column", () => {
    const fromSchema = models.filter((m) => m.hasWorkspaceId).map((m) => m.name).sort();
    expect([...TENANT_MODELS].sort()).toEqual(fromSchema);
  });

  it("classifies every model as tenant, root or global (no unclassified tables)", () => {
    const known = new Set<string>([...TENANT_MODELS, ...GLOBAL_MODELS, ROOT_MODEL]);
    expect(models.map((m) => m.name).filter((n) => !known.has(n))).toEqual([]);
  });
});
