import { setSkin } from "@/app/actions/skin";
import { getCopy, type SkinKey } from "@/copy";

/** Switches the whole app to the other skin. Shows only the skin it will switch to. */
export function SkinToggle({ skin }: { skin: SkinKey }) {
  const t = getCopy(skin);
  const next: SkinKey = skin === "haunted" ? "professional" : "haunted";
  const nextLabel = next === "haunted" ? t.settings.skinHaunted : t.settings.skinProfessional;

  return (
    <form action={setSkin}>
      <input type="hidden" name="skin" value={next} />
      <button
        type="submit"
        data-testid="skin-toggle"
        className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent"
      >
        {t.settings.switchSkinTo(nextLabel)}
      </button>
    </form>
  );
}
