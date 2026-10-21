"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { parseSkin, SKIN_COOKIE } from "@/lib/skin";

/**
 * Switches the whole app between skins. M1 extends this to also persist
 * `Workspace.skin` when the caller is inside a workspace.
 */
export async function setSkin(formData: FormData): Promise<void> {
  const skin = parseSkin(formData.get("skin")?.toString());
  (await cookies()).set(SKIN_COOKIE, skin, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
