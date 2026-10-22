import { AppShell } from "@/components/app-shell";
import { DeclareIncidentProvider } from "@/components/declare-incident";
import { listServices } from "@/features/services/service";
import { getWorkspaceContext } from "@/server/auth/context";
import { listWorkspacesForUser } from "@/server/db/root";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/app/[slug]">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const [memberships, services] = await Promise.all([listWorkspacesForUser(ctx.user.id), listServices(ctx.db)]);
  const workspaces = memberships.map(({ workspace }) => ({ slug: workspace.slug, name: workspace.name }));

  return (
    <DeclareIncidentProvider
      slug={ctx.workspace.slug}
      services={services.map((s) => ({ id: s.id, name: s.name }))}
      canCreateServices={ctx.can("members.invite")}
      severityLabels={ctx.workspace.severityLabels as Record<string, string> | null}
    >
      <AppShell skin={ctx.skin} slug={ctx.workspace.slug} userEmail={ctx.user.email} workspaces={workspaces}>
        {children}
      </AppShell>
    </DeclareIncidentProvider>
  );
}
