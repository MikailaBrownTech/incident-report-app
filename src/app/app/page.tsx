import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LAST_WORKSPACE_COOKIE } from "@/lib/last-workspace";
import { getSession } from "@/server/auth/session";
import { getWorkspaceForMember, listWorkspacesForUser } from "@/server/db/root";

/** /app: go to the last-used workspace (if still a member), else the first one, else onboarding. */
export default async function AppIndex() {
  const session = await getSession();
  if (!session) redirect("/sign-in?callbackUrl=/app");

  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  if (last && (await getWorkspaceForMember(last, session.user.id))) {
    redirect(`/app/${last}/dashboard`);
  }
  const [first] = await listWorkspacesForUser(session.user.id);
  redirect(first ? `/app/${first.workspace.slug}/dashboard` : "/onboarding");
}
