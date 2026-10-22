import { z } from "zod";

export const workspaceNameSchema = z.string().trim().min(1).max(60);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);

/** Only same-site relative paths survive; anything else falls back to "/". */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
