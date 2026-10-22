import { AppShell } from "@/components/app-shell";
import { requireWorkspace } from "@/server/auth/context";
import { listWorkspacesForUser } from "@/server/db/root";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  const workspaces = (await listWorkspacesForUser(ctx.user.id)).map((w) => w.workspace);

  return (
    <AppShell
      skin={ctx.skin}
      slug={ctx.workspace.slug}
      workspaceName={ctx.workspace.name}
      userEmail={ctx.user.email}
      workspaces={workspaces}
    >
      {children}
    </AppShell>
  );
}
