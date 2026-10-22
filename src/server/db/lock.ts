import type { Prisma } from "@/generated/prisma/client";

/**
 * Takes a row lock on the workspace until the surrounding transaction ends, so concurrent changes to
 * shared per-workspace invariants (e.g. "there is always one owner") run one after another.
 *
 * Preferred over `Serializable` isolation: that aborts unrelated transactions with serialization failures
 * (Postgres tracks predicates coarsely on small tables), which users would see as random 500s.
 * Lives here because raw SQL is only allowed inside src/server/db.
 */
export async function lockWorkspace(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  workspaceId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
}
