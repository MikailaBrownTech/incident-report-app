/** Anything with a workspace `update`: a plain or a tenant-scoped transaction client. */
interface WorkspaceLocker {
  workspace: {
    update(args: {
      where: { id: string };
      data: { nextIncidentNumber: { increment: number } };
      select: { id: true };
    }): PromiseLike<unknown>;
  };
}

/**
 * Takes a row lock on the workspace until the surrounding transaction ends, so concurrent changes to
 * shared per-workspace invariants (e.g. "there is always one owner", card order in a board column) run one
 * after another.
 *
 * Done with a no-op UPDATE of the workspace row, the same statement incident numbering relies on, because a
 * `SELECT ... FOR UPDATE` issued through `$queryRaw` did NOT hold the lock for the rest of the transaction (a probe
 * showed three concurrent transactions all "holding" it at once).
 *
 * Preferred over `Serializable` isolation: that aborts unrelated transactions with serialization failures
 * (Postgres tracks predicates coarsely on small tables), which users would see as random 500s.
 */
export async function lockWorkspace(tx: WorkspaceLocker, workspaceId: string): Promise<void> {
  await tx.workspace.update({
    where: { id: workspaceId },
    data: { nextIncidentNumber: { increment: 0 } },
    select: { id: true },
  });
}
