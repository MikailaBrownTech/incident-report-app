import { z } from "zod";
import { ForbiddenError } from "@/server/auth/permissions";

/**
 * Standard error shape for every API route:
 *   { "error": { "code": "validation_error", "message": "...", "fieldErrors": { "slug": ["slug_taken"] } } }
 */
export interface ApiErrorBody {
  error: { code: string; message: string; fieldErrors?: Record<string, string[]> };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) },
    };
    return Response.json(body, { status: err.status });
  }
  if (err instanceof ForbiddenError) {
    return errorResponse(new ApiError(403, "forbidden", "You don't have permission to do that."));
  }
  console.error("[api] unhandled error", err);
  return errorResponse(new ApiError(500, "internal_error", "Something went wrong."));
}

/** Wrap a route handler so thrown ApiError/ForbiddenError/unknown errors become the standard shape. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Parse and validate a JSON body; failures become a 400 with per-field error codes. */
export async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "validation_error",
      "Some fields are invalid.",
      z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    );
  }
  return parsed.data;
}
