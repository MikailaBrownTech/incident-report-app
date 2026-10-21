import { notFound } from "next/navigation";
import { DueLabel, SeverityBadge, StatusPill } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { Fog } from "@/components/fog";
import { SkinToggle } from "@/components/skin-toggle";
import {
  EMPTY_KEYS,
  getCopy,
  severityName,
  type IncidentStatusKey,
  type SeverityLevel,
} from "@/copy";
import { getSkin } from "@/lib/skin";
import { skinTokens } from "@/styles/tokens";

const LEVELS: SeverityLevel[] = [1, 2, 3, 4, 5];
const STATUSES: IncidentStatusKey[] = ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"];

/**
 * Developer styleguide for the ACTIVE skin only; use the toggle to switch.
 * `page.dev.tsx` is not a route in production builds (see next.config.ts), and the
 * guard below is a second line of defence.
 */
export default async function StyleguidePage() {
  if (process.env.NODE_ENV === "production") notFound();

  const skin = await getSkin();
  const t = getCopy(skin);

  return (
    <main className="relative isolate flex-1">
      <Fog />
      <div className="relative z-10 mx-auto max-w-4xl space-y-10 p-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="flicker text-3xl font-bold">
            {t.brand.name} / styleguide ({skin})
          </h1>
          <SkinToggle skin={skin} />
        </header>

        <Section title="Colour tokens">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Object.entries(skinTokens[skin]).map(([name, value]) => (
              <li key={name} className="rounded border border-border bg-surface p-2 text-xs">
                <span
                  className="mb-2 block h-8 rounded border border-border"
                  style={{ background: value }}
                />
                {name}
                <span className="block text-muted">{value}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Typography">
          <p className="text-3xl font-bold">{t.incident.plural}</p>
          <p>{t.incident.number(42)}</p>
          <p className="text-muted">{t.postmortem.blamelessNote}</p>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <button className="rounded bg-accent px-4 py-2 font-medium text-accent-fg">
              {t.incident.newIncident}
            </button>
            <button className="rounded border border-border bg-surface px-4 py-2">
              {t.actions.cancel}
            </button>
            <button className="rounded border border-danger px-4 py-2 text-danger">
              {t.actions.delete}
            </button>
          </div>
        </Section>

        <Section title="Severity">
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <SeverityBadge key={l} level={l} label={severityName(t, l)} />
            ))}
          </div>
        </Section>

        <Section title="Status">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusPill key={s} label={t.status[s]} resolved={s === "RESOLVED"} />
            ))}
          </div>
        </Section>

        <Section title="Roles">
          <ul className="flex flex-wrap gap-2 text-sm">
            {[...Object.values(t.incidentRole), ...Object.values(t.workspaceRole)].map((r) => (
              <li key={r} className="rounded border border-border px-2 py-0.5">
                {r}
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t.ritual.plural}>
          <div className="space-y-2">
            <DueLabel label={t.ritual.dueIn(5)} overdue={false} iconLabel={t.a11y.overdueIcon} />
            <br />
            <DueLabel label={t.ritual.overdueBy(3)} overdue iconLabel={t.a11y.overdueIcon} />
            <p className="text-sm text-muted">
              {Object.values(t.ritual.statusLabel).join(" · ")}
            </p>
          </div>
        </Section>

        <Section title={t.revenant.singular}>
          <p className="rounded border border-accent px-3 py-2">{t.revenant.hauntedNTimes(3)}</p>
        </Section>

        <Section title={t.postmortem.singular}>
          <dl className="space-y-3">
            {Object.values(t.postmortem.sections).map((s) => (
              <div key={s.title} className="rounded border border-border bg-surface p-3">
                <dt className="font-semibold">{s.title}</dt>
                <dd className="text-sm text-muted">{s.prompt}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Empty states">
          <div className="space-y-2">
            {EMPTY_KEYS.map((k) => (
              <EmptyState key={k} message={t.empty[k][0]} />
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="border-b border-border pb-1 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
