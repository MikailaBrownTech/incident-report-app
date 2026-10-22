import { ROOT_MODEL, isGlobalModel, isTenantModel } from "./tenant-models";

export type Args = Record<string, unknown> | undefined;

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(`[tenant] ${message}`);
    this.name = "TenantScopeError";
  }
}

const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);
// Prisma lets unique-where inputs carry extra non-unique filters, so scoping stays a single query.
const UNIQUE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete"]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATE_OPS = new Set(["update", "updateMany", "updateManyAndReturn"]);

/**
 * Models with a soft-delete column. Reads and updates through the scoped client only see live rows
 * (`deletedAt: null`). A caller that really needs deleted rows passes `deletedAt` explicitly
 * (`deletedAt: undefined` means "any").
 */
const SOFT_DELETE: Record<string, string> = { Incident: "deletedAt" };

function liveOnly(where: unknown, model: string): unknown {
  const column = SOFT_DELETE[model];
  if (!column) return where;
  const w = (where ?? {}) as Record<string, unknown>;
  return column in w ? w : { ...w, [column]: null };
}

/** The column that identifies the tenant on a model. */
const scopeKey = (model: string) => (model === ROOT_MODEL ? "id" : "workspaceId");

function scopedWhere(where: unknown, key: string, workspaceId: string) {
  const w = (where ?? {}) as Record<string, unknown>;
  if (key in w && w[key] !== workspaceId) {
    throw new TenantScopeError(`query filters ${key} to a different workspace than the scoped client`);
  }
  return { ...w, [key]: workspaceId };
}

function scopedData(data: unknown, key: string, workspaceId: string, setOnCreate: boolean) {
  const d = (data ?? {}) as Record<string, unknown>;
  if (key in d && d[key] !== workspaceId) {
    throw new TenantScopeError(`write sets ${key} to a different workspace than the scoped client`);
  }
  return setOnCreate ? { ...d, [key]: workspaceId } : d;
}

/**
 * Pure arg rewriting behind `scopedDb`; exported so it can be unit-tested without a
 * database. Throws for anything that could cross a tenant boundary.
 */
export function scopeArgs(model: string, operation: string, args: Args, workspaceId: string): Args {
  if (!workspaceId) throw new TenantScopeError("workspaceId is required");
  if (isGlobalModel(model)) {
    throw new TenantScopeError(`${model} is a global table; it is not accessible from a workspace-scoped client`);
  }
  if (model !== ROOT_MODEL && !isTenantModel(model)) {
    throw new TenantScopeError(`${model} is not registered in TENANT_MODELS`);
  }
  if (model === ROOT_MODEL && CREATE_OPS.has(operation)) {
    throw new TenantScopeError("workspaces are created via root.ts, not a scoped client");
  }

  const key = scopeKey(model);
  const a: Record<string, unknown> = { ...(args ?? {}) };

  if (WHERE_OPS.has(operation) || UNIQUE_OPS.has(operation)) {
    a.where = liveOnly(scopedWhere(a.where, key, workspaceId), model);
  } else if (operation === "upsert") {
    a.where = liveOnly(scopedWhere(a.where, key, workspaceId), model);
    a.create = scopedData(a.create, key, workspaceId, true);
    a.update = scopedData(a.update, key, workspaceId, false);
  } else if (CREATE_OPS.has(operation)) {
    a.data = Array.isArray(a.data)
      ? a.data.map((row) => scopedData(row, key, workspaceId, true))
      : scopedData(a.data, key, workspaceId, true);
  } else {
    throw new TenantScopeError(`operation ${operation} is not supported on a scoped client`);
  }

  if (UPDATE_OPS.has(operation)) a.data = scopedData(a.data, key, workspaceId, false);
  return a;
}
