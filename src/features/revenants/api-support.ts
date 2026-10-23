import { z } from "zod";
import { ApiError } from "@/server/api/http";
import type { LinkError, UnlinkError } from "./link";

const LINK: Record<LinkError, ApiError> = {
  not_found: new ApiError(404, "not_found", "Incident not found."),
  self: new ApiError(400, "validation_error", "An incident can't be a recurrence of itself.", {
    revenantOfNumber: ["self"],
  }),
  target_not_earlier: new ApiError(400, "validation_error", "Link the later incident to the earlier one.", {
    revenantOfNumber: ["target_not_earlier"],
  }),
  cycle: new ApiError(409, "revenant_cycle", "That link would make an incident a recurrence of its own recurrence."),
};
const UNLINK: Record<UnlinkError, ApiError> = {
  not_found: new ApiError(404, "not_found", "Incident not found."),
  not_linked: new ApiError(409, "not_linked", "This incident isn't linked to anything."),
  is_root: new ApiError(409, "is_root", "This is the first occurrence. Unlink the later ones instead."),
};
export const linkFailure = (e: LinkError) => LINK[e];
export const unlinkFailure = (e: UnlinkError) => UNLINK[e];

export const linkBody = z.object({ revenantOfNumber: z.number().int().positive() });
export const dismissBody = z.object({ candidateNumber: z.number().int().positive() });

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const suggestionsQuery = z.object({
  title: z.preprocess(blank, z.string().trim().max(200, "too_long").default("")),
  services: z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : Array.isArray(v)
          ? v.flatMap((x) => String(x).split(","))
          : [],
    z.array(z.string().min(1).max(100)).max(25),
  ),
  excludeNumber: z.preprocess(
    blank,
    z.coerce.number({ error: "invalid_number" }).int("invalid_number").min(1, "invalid_number").optional(),
  ),
  startedBefore: z.preprocess(blank, z.iso.datetime({ offset: true, error: "invalid_date" }).optional()),
  limit: z.preprocess(
    blank,
    z.coerce
      .number({ error: "invalid_limit" })
      .int("invalid_limit")
      .min(1, "invalid_limit")
      .max(10, "invalid_limit")
      .default(5),
  ),
});

export function searchParamsToRaw(request: Request): Record<string, string | string[]> {
  const raw: Record<string, string | string[]> = {};
  const search = new URL(request.url).searchParams;
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  return raw;
}

export function validationError(error: z.ZodError): ApiError {
  return new ApiError(
    400,
    "validation_error",
    "Some parameters are invalid.",
    z.flattenError(error).fieldErrors as Record<string, string[]>,
  );
}
