import { ApiError } from "@/server/api/http";
import type { NoteError } from "./notes";

const FAILURES: Record<NoteError, ApiError> = {
  not_found: new ApiError(404, "not_found", "Not found."),
  forbidden: new ApiError(403, "forbidden", "Only the author or an admin can change this note."),
  event_immutable: new ApiError(403, "event_immutable", "Automatic timeline entries can't be changed."),
  in_future: new ApiError(400, "validation_error", "That time is in the future.", { occurredAt: ["in_future"] }),
};

export const noteFailure = (error: NoteError): ApiError => FAILURES[error];
