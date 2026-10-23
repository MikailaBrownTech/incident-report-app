/**
 * Every Prisma model that carries a `workspaceId` column. `tenant.test.ts` parses
 * schema.prisma and fails if this list drifts, so a new tenant model can't silently
 * skip scoping.
 */
export const TENANT_MODELS = [
  "Membership",
  "Invite",
  "Service",
  "Incident",
  "IncidentService",
  "IncidentAssignment",
  "Event",
  "Integration",
  "Postmortem",
  "PostmortemSection",
  "ActionItem",
  "RetroRule",
  "PostmortemTemplate",
  "AuditLog",
  "RevenantDismissal",
] as const;

/** The tenant root; scoped by its own `id`. */
export const ROOT_MODEL = "Workspace";

/** Auth tables. Not reachable from a workspace-scoped client at all. */
export const GLOBAL_MODELS = ["User", "Session", "Account", "Verification"] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];

const tenantSet = new Set<string>(TENANT_MODELS);
const globalSet = new Set<string>(GLOBAL_MODELS);

export const isTenantModel = (m: string): m is TenantModel => tenantSet.has(m);
export const isGlobalModel = (m: string) => globalSet.has(m);
