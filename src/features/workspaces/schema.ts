import { z } from "zod";
import { slugSchema } from "./slug";

export const workspaceNameSchema = z.string().trim().min(1, "required").max(60, "too_long");
export const emailSchema = z.string().trim().toLowerCase().email("invalid_email").max(254, "too_long");
export const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export const inviteRoleSchema = z.enum(["ADMIN", "MEMBER"]);

export const createWorkspaceBody = z.object({ name: workspaceNameSchema, slug: slugSchema });
export const updateWorkspaceBody = z
  .object({ name: workspaceNameSchema.optional(), skin: z.enum(["haunted", "professional"]).optional() })
  .refine((v) => v.name !== undefined || v.skin !== undefined, { message: "nothing_to_update" });
export const changeRoleBody = z.object({ role: roleSchema });
export const createInviteBody = z.object({ email: emailSchema, role: inviteRoleSchema });
export const acceptInviteBody = z.object({ token: z.string().min(10).max(200) });

/** Only same-site relative paths survive; anything else falls back to "/". */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
