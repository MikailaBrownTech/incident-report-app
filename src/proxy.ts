import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { LAST_WORKSPACE_COOKIE } from "@/lib/last-workspace";

/**
 * Guards every /app route. Signed-out visitors go to /sign-in with a callbackUrl. This only
 * checks that a session cookie exists (cheap, optimistic); the real session and membership
 * checks happen in getWorkspaceContext / getApiWorkspaceContext.
 * It also forwards the pathname (so the root layout can pick the workspace's skin) and
 * remembers the last-used workspace in a cookie.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!getSessionCookie(request)) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  const response = NextResponse.next({ request: { headers } });

  const slug = /^\/app\/([^/]+)/.exec(pathname)?.[1];
  if (slug) {
    response.cookies.set(LAST_WORKSPACE_COOKIE, decodeURIComponent(slug), {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

export const config = { matcher: ["/app/:path*", "/app"] };
