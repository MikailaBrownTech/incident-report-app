import { AppShell } from "@/components/app-shell";
import { getWorkspaceContext } from "@/server/auth/context";
import { listWorkspacesForUser } from "@/server/db/root";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/app/[slug]">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const workspaces = (await listWorkspacesForUser(ctx.user.id)).map(({ workspace }) => ({
    slug: workspace.slug,
    name: workspace.name,
  }));

  return (
    <AppShell skin={ctx.skin} slug={ctx.workspace.slug} userEmail={ctx.user.email} workspaces={workspaces}>
      {children}
    </AppShell>
  );
}
