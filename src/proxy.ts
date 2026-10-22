import { NextResponse, type NextRequest } from "next/server";

/**
 * Forwards the pathname so the root layout can pick the workspace's skin for /w/<slug>/*
 * routes (a layout above `[slug]` otherwise has no access to it).
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/w/:path*" };
