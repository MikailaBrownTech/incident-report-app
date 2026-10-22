import { cookies, headers } from "next/headers";
import { z } from "zod";
import type { SkinKey } from "@/copy";
import { getWorkspaceSkin } from "@/server/auth/context";

export const SKIN_COOKIE = "crypt-skin";
export const DEFAULT_SKIN: SkinKey = "haunted";

const skinSchema = z.enum(["haunted", "professional"]);

export function parseSkin(value: string | undefined | null): SkinKey {
  const parsed = skinSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SKIN;
}

/**
 * The one skin for this request. Inside /w/<slug> it is that workspace's setting
 * (the path comes from src/proxy.ts); everywhere else, including before login, it is
 * the `crypt-skin` cookie, defaulting to haunted.
 */
export async function getSkin(): Promise<SkinKey> {
  const slug = /^\/w\/([^/]+)/.exec((await headers()).get("x-pathname") ?? "")?.[1];
  if (slug) {
    const workspaceSkin = await getWorkspaceSkin(decodeURIComponent(slug));
    if (workspaceSkin) return workspaceSkin;
  }
  return parseSkin((await cookies()).get(SKIN_COOKIE)?.value);
}
