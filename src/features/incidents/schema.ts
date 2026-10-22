import { z } from "zod";

/** Pure (no server imports): shared by the API routes and the client components. */
export const ROLE_KEYS = ["COMMANDER", "SCRIBE", "COMMS"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const ALL_STATUSES = ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"] as const;
export type StatusKey = (typeof ALL_STATUSES)[number];

export const titleSchema = z.string().trim().min(1, "required").max(140, "too_long");
export const summarySchema = z.string().trim().max(20_000, "too_long");
export const severitySchema = z.number().int("invalid").min(1, "invalid").max(5, "invalid");

export const patchIncidentBody = z
  .object({
    title: titleSchema.optional(),
    summary: summarySchema.optional(),
    severity: severitySchema.optional(),
    serviceIds: z.array(z.string().min(1)).max(25).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing_to_update" });

export const statusBody = z.object({ status: z.enum(ALL_STATUSES) });

const holder = z.string().min(1).nullable().optional();
/** `userId` assigns, `null` unassigns, omitted leaves the role alone. */
export const rolesBody = z
  .object({ COMMANDER: holder, SCRIBE: holder, COMMS: holder })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing_to_update" });

export const incidentNumberSchema = z.string().regex(/^\d{1,9}$/);

export interface PersonView {
  userId: string;
  name: string;
  email: string;
  image: string | null;
}

export interface IncidentDetailView {
  id: string;
  number: number;
  title: string;
  summary: string;
  severity: number;
  status: StatusKey;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  createdBy: { name: string; email: string } | null;
  services: { id: string; name: string }[];
  roles: Record<RoleKey, PersonView | null>;
}
