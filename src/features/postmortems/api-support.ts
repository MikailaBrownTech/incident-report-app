import { ApiError, json } from "@/server/api/http";
import type { Failure, Result } from "./service";

function failure(f: Failure): Response {
  switch (f.error) {
    case "not_found":
      throw new ApiError(404, "not_found", "Not found.");
    case "exists":
      throw new ApiError(409, "postmortem_exists", "This incident already has a postmortem.");
    case "invalid_template":
      throw new ApiError(400, "validation_error", "That template doesn't exist.", { templateId: ["invalid_template"] });
    case "published":
      throw new ApiError(
        409,
        "postmortem_published",
        "A published postmortem is read-only. An admin can unpublish it.",
      );
    case "not_published":
      throw new ApiError(409, "not_published", "This postmortem isn't published.");
    case "forbidden":
      throw new ApiError(403, "forbidden", "Only an admin or owner can unpublish a postmortem.");
    case "too_large":
      throw new ApiError(413, "content_too_large", "That is more text than a postmortem can hold.");
    case "invalid_content": {
      const p = f.problem;
      const key = "key" in p ? p.key : "sections";
      const code = p.code === "invalid_document" ? p.problem : p.code;
      throw new ApiError(400, "invalid_content", "Some of that content isn't allowed.", { [key]: [code] });
    }
    case "missing_sections":
      throw new ApiError(422, "missing_sections", "Some required sections are empty or too short.", {
        sections: f.missing,
      });
    case "conflict":
      // the editor needs the server's copy to offer "load theirs", so this one carries the latest content
      return Response.json(
        { error: { code: "version_conflict", message: "Someone else saved a newer version." }, latest: f.latest },
        { status: 409 },
      );
  }
}

/** Success becomes a JSON response; every failure becomes the standard error shape (or the conflict body). */
export const respond = (result: Result, status = 200): Response =>
  result.ok ? json(result.payload, status) : failure(result);
