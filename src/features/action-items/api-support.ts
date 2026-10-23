import { ApiError, json } from "@/server/api/http";
import type { ItemError, ItemResult } from "./service";

const FAILURES: Record<ItemError, ApiError> = {
  not_found: new ApiError(404, "not_found", "Not found."),
  no_postmortem: new ApiError(
    409,
    "no_postmortem",
    "This incident has no postmortem yet. Start the autopsy first, then add action items to it.",
  ),
  invalid_owner: new ApiError(400, "validation_error", "The owner must be a member of this workspace.", {
    ownerId: ["not_a_member"],
  }),
  forbidden: new ApiError(403, "forbidden", "Only the owner of this item or an admin can change it."),
  reason_required: new ApiError(400, "validation_error", "Say why this won't be done.", {
    wontDoReason: ["required"],
  }),
};

export const itemFailure = (error: ItemError) => FAILURES[error];

/** Success becomes JSON; a failure becomes the standard error shape. */
export function respond(result: ItemResult, status = 200): Response {
  if (!result.ok) throw itemFailure(result.error);
  return json({ items: result.items, people: result.people }, status);
}
