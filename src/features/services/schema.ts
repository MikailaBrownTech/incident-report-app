import { z } from "zod";

/** Pure (no server imports) so client components can validate with the same rules as the API. */
export const serviceNameSchema = z.string().trim().min(1, "required").max(60, "too_long");
export const createServiceBody = z.object({ name: serviceNameSchema });
export const updateServiceBody = z.object({ name: serviceNameSchema });

export interface ServiceView {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  /** Incidents linked to this service that are not resolved. */
  openIncidents: number;
  /** All incidents linked to this service (what deleting would unlink). */
  totalIncidents: number;
}
