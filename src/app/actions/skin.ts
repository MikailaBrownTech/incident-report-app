"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { parseSkin, SKIN_COOKIE } from "@/lib/skin";
import { getWorkspaceContext, toSkinEnum } from "@/server/auth/context";

/**
 * Switches the whole app between skins. Inside a workspace (a `workspace` slug is posted)
 * it persists Workspace.skin, which every member sees; the cookie is always updated too so
 * the choice carries over to pre-login pages.
 */
export async function setSkin(formData: FormData): Promise<void> {
  const skin = parseSkin(formData.get("skin")?.toString());
  const slug = formData.get("workspace")?.toString();

  if (slug) {
    const ctx = await getWorkspaceContext(slug);
    if (ctx.can("skin.update")) {
      await ctx.db.workspace.update({ where: { id: ctx.workspace.id }, data: { skin: toSkinEnum(skin) } });
    }
  }

  (await cookies()).set(SKIN_COOKIE, skin, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
