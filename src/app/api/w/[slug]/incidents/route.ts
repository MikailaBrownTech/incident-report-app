import { declareIncident, declareIncidentBody, type DeclareError } from "@/features/incidents/declare";
import { listIncidents } from "@/features/incidents/list";
import { parseListParams, rawFromSearchParams } from "@/features/incidents/list-params";
import { ApiError, handle, json, readBody } from "@/server/api/http";
import { getApiWorkspaceContext } from "@/server/auth/context";

const FAILURES: Record<DeclareError, ApiError> = {
  forbidden: new ApiError(403, "forbidden", "Only admins and owners can create services."),
  invalid_service: new ApiError(400, "invalid_service", "One of the selected services doesn't exist.", {
    serviceIds: ["invalid_service"],
  }),
  name_taken: new ApiError(409, "name_taken", "A service with that name already exists.", {
    newServiceNames: ["name_taken"],
  }),
  started_in_future: new ApiError(400, "validation_error", "The start time can't be in the future.", {
    startedAt: ["in_future"],
  }),
};

/** GET /api/w/{slug}/incidents: one filtered, sorted page. Query: q, status, severity, service, from, to, open, sort, dir, after. */
export const GET = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/incidents">) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  const listParams = parseListParams(rawFromSearchParams(new URL(request.url).searchParams));
  return json(await listIncidents(ctx.db, listParams));
});

/** POST /api/w/{slug}/incidents: declare an incident. Any member can; creating services inline needs an admin. */
export const POST = handle(async (request: Request, { params }: RouteContext<"/api/w/[slug]/incidents">) => {
  const ctx = await getApiWorkspaceContext((await params).slug);
  ctx.assert("incident.write");
  const body = await readBody(request, declareIncidentBody);

  const result = await declareIncident(ctx, body);
  if (!result.ok) throw FAILURES[result.error];
  return json({ incident: result.incident }, 201);
});
