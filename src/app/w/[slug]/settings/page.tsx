import { inputClass, labelClass, primaryButton } from "@/components/form";
import { getCopy } from "@/copy";
import { renameWorkspaceAction } from "@/features/workspaces/actions";
import { requireWorkspace } from "@/server/auth/context";

export default async function SettingsPage({ params, searchParams }: PageProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  const { e, ok } = await searchParams;
  const ctx = await requireWorkspace(slug);
  const t = getCopy(ctx.skin);
  const canRename = ctx.can("workspace.rename");

  return (
    <div className="max-w-md space-y-6">
      {e ? (
        <p role="alert" className="rounded border border-danger px-3 py-2 text-danger">
          {e === "forbidden" ? t.errors.forbidden : t.validation.required}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded border border-success px-3 py-2 text-success">
          {t.members.updated}
        </p>
      ) : null}

      <form action={renameWorkspaceAction.bind(null, slug)} className="space-y-3">
        <div>
          <label htmlFor="name" className={labelClass}>
            {t.settings.workspaceName}
          </label>
          <input
            id="name"
            name="name"
            defaultValue={ctx.workspace.name}
            maxLength={60}
            required
            disabled={!canRename}
            className={inputClass}
          />
        </div>
        {canRename ? (
          <button type="submit" className={primaryButton}>
            {t.settings.save}
          </button>
        ) : null}
      </form>

      <p className="text-sm text-muted">{t.settings.planLine(t.settings.planName[ctx.workspace.plan])}</p>
    </div>
  );
}
