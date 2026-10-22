import { ApiError } from "@/server/api/http";
import type { UpdateError } from "./update";
import { incidentNumberSchema } from "./schema";

/** `/incidents/abc` and `/incidents/0042x` are simply "no such incident". */
export function parseIncidentNumber(raw: string): number {
  if (!incidentNumberSchema.safeParse(raw).success) throw new ApiError(404, "not_found", "Incident not found.");
  return Number(raw);
}

const FAILURES: Record<UpdateError, ApiError> = {
  not_found: new ApiError(404, "not_found", "Incident not found."),
  invalid_service: new ApiError(400, "invalid_service", "One of the selected services doesn't exist.", {
    serviceIds: ["invalid_service"],
  }),
  not_a_member: new ApiError(400, "not_a_member", "Only members of this workspace can be assigned a role.", {
    roles: ["not_a_member"],
  }),
};

export const updateFailure = (error: UpdateError): ApiError => FAILURES[error];
