import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "./client";
import { TenantScopeError, scopeArgs, type Args } from "./scope";

export { TenantScopeError, scopeArgs } from "./scope";

/**
 * The ONLY way application code touches tenant data. Every query on a registered model
 * is forced to the given workspace; global auth tables are unreachable; raw SQL is
 * typed away (and ESLint-banned outside src/server/db).
 */
export function forWorkspace(workspaceId: string, client: PrismaClient = prisma) {
  if (!workspaceId) throw new TenantScopeError("workspaceId is required");
  const extended = client.$extends({
    name: "tenant-scope",
    // Pass `data: { workspaceId: db.$workspaceId, ... }` on creates: Prisma's types require it,
    // and a value that differs from the scoped workspace throws.
    client: { $workspaceId: workspaceId },
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, workspaceId) as typeof args);
        },
      },
    },
  });
  return extended as Omit<
    typeof extended,
    "$queryRaw" | "$queryRawUnsafe" | "$executeRaw" | "$executeRawUnsafe" | "$connect" | "$disconnect" | "user" | "session" | "account" | "verification"
  >;
}

export type ScopedDb = ReturnType<typeof forWorkspace>;
