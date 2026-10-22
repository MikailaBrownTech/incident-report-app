import type { Role } from "@/generated/prisma/client";

export type Action =
  | "workspace.rename"
  | "workspace.delete"
  | "skin.update"
  | "severity.update"
  | "retro.update"
  | "members.view"
  | "members.invite"
  | "members.manage"
  | "billing.view"
  | "incident.write";

const MATRIX: Record<Action, readonly Role[]> = {
  "workspace.rename": ["OWNER", "ADMIN"],
  "workspace.delete": ["OWNER"],
  // Skin is a cosmetic per-workspace setting; every member may switch it.
  "skin.update": ["OWNER", "ADMIN", "MEMBER"],
  "severity.update": ["OWNER", "ADMIN"],
  "retro.update": ["OWNER", "ADMIN"],
  "members.view": ["OWNER", "ADMIN", "MEMBER"],
  "members.invite": ["OWNER", "ADMIN"],
  "members.manage": ["OWNER", "ADMIN"],
  "billing.view": ["OWNER"],
  "incident.write": ["OWNER", "ADMIN", "MEMBER"],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Role-change rules on top of `members.manage`: only owners create or alter owners,
 * so an admin can't promote themselves or demote an owner.
 */
export function canAssignRole(actor: Role, targetCurrent: Role, next: Role): boolean {
  if (!can(actor, "members.manage")) return false;
  if (actor === "OWNER") return true;
  return targetCurrent !== "OWNER" && next !== "OWNER";
}

export function canRemoveMember(actor: Role, target: Role): boolean {
  if (!can(actor, "members.manage")) return false;
  return actor === "OWNER" || target !== "OWNER";
}
