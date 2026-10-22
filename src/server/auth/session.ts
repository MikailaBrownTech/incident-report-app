import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./auth";

/** The signed-in user for this request (deduped per request), or null. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));
