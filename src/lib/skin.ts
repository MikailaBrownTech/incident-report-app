import { cookies } from "next/headers";
import { z } from "zod";
import type { SkinKey } from "@/copy";

export const SKIN_COOKIE = "crypt-skin";
export const DEFAULT_SKIN: SkinKey = "haunted";

const skinSchema = z.enum(["haunted", "professional"]);

export function parseSkin(value: string | undefined | null): SkinKey {
  const parsed = skinSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SKIN;
}

/**
 * The one skin for this request. Pre-login pages use the cookie (default haunted).
 * Workspace pages pass the workspace's skin, which wins over the cookie.
 */
export async function getSkin(workspaceSkin?: SkinKey): Promise<SkinKey> {
  if (workspaceSkin) return workspaceSkin;
  return parseSkin((await cookies()).get(SKIN_COOKIE)?.value);
}
