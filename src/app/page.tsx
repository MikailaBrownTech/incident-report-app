import { Fog } from "@/components/fog";
import { emptyMessage, getCopy, severityName, type SeverityLevel, type SkinKey } from "@/copy";

const SKINS: SkinKey[] = ["haunted", "professional"];
const LEVELS: SeverityLevel[] = [1, 2, 3, 4, 5];

/** M0 skin preview. Replaced by the real landing page in M1. */
export default function Home() {
  return (
    <main className="grid flex-1 md:grid-cols-2">
      {SKINS.map((skin) => {
        const t = getCopy(skin);
        return (
          <section
            key={skin}
            data-skin={skin}
            className="relative isolate bg-bg p-8 text-fg"
          >
            <Fog />
            <div className="relative z-10 space-y-6">
              <h1 className="flicker text-3xl font-bold">{t.brand.name}</h1>
              <p className="text-muted">{t.brand.tagline}</p>
              <h2 className="text-xl font-semibold">{t.incident.plural}</h2>
              <ul className="space-y-2">
                {LEVELS.map((l) => (
                  <li key={l} className="rounded border border-border bg-surface px-3 py-2">
                    {severityName(t, l)}
                  </li>
                ))}
              </ul>
              <p className="text-danger">{t.ritual.overdueBy(3)}</p>
              <p className="text-muted">{emptyMessage(t, "incidents")}</p>
              <button className="rounded bg-accent px-4 py-2 font-medium text-accent-fg">
                {t.incident.newIncident}
              </button>
            </div>
          </section>
        );
      })}
    </main>
  );
}
