import { SkinToggle } from "@/components/skin-toggle";
import { WorkspaceNameForm } from "@/components/workspace-name-form";
import { getCopy } from "@/copy";
import { getWorkspaceContext } from "@/server/auth/context";

export default async function SettingsPage({ params }: PageProps<"/app/[slug]/settings">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const t = getCopy(ctx.skin);

  return (
    <div className="max-w-md space-y-8">
      <WorkspaceNameForm slug={slug} initialName={ctx.workspace.name} canEdit={ctx.can("workspace.rename")} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.settings.skin}</h2>
        <SkinToggle skin={ctx.skin} workspaceSlug={slug} />
      </section>

      <p className="text-sm text-muted">{t.settings.planLine(t.settings.planName[ctx.workspace.plan])}</p>
    </div>
  );
}
