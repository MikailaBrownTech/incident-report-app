import type { IncidentStatus, PrismaClient, Prisma } from "@/generated/prisma/client";

/**
 * Demo data for local development: one workspace ("demo") with 5 people, 8 services and 15 incidents spread
 * over ~90 days, including look-alike titles for revenant detection.
 *
 * Idempotent: everything is keyed on fixed ids, slugs or incident numbers, and an incident that already exists
 * is skipped entirely (children included), so running it twice duplicates nothing and never overwrites edits.
 * It takes the Prisma client as a parameter so tests can point it at a throwaway schema.
 */

export const DEMO_SLUG = "demo";
const DOMAIN = "crypt-demo.example";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const PEOPLE = [
  { id: "seed-user-morgan", name: "Morgan Hale", role: "OWNER" },
  { id: "seed-user-riley", name: "Riley Chen", role: "ADMIN" },
  { id: "seed-user-sam", name: "Sam Okafor", role: "MEMBER" },
  { id: "seed-user-priya", name: "Priya Raman", role: "MEMBER" },
  { id: "seed-user-diego", name: "Diego Alvarez", role: "MEMBER" },
] as const;
const emailOf = (id: string) => `${id.replace("seed-user-", "")}@${DOMAIN}`;
const person = (key: string) => PEOPLE.find((p) => p.id === `seed-user-${key}`)!.id;

const SERVICES = [
  "API Gateway",
  "Checkout API",
  "Payments",
  "Search",
  "Auth",
  "Notifications",
  "Database",
  "Web App",
] as const;
type ServiceName = (typeof SERVICES)[number];
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

interface Spec {
  number: number;
  title: string;
  summary: string;
  severity: number;
  status: IncidentStatus;
  /** How long ago it started. */
  startedAgo: number;
  /** Time to resolve (resolved incidents only). */
  durationMin?: number;
  services: ServiceName[];
  roles: { COMMANDER?: string; SCRIBE?: string; COMMS?: string };
  notes?: string[];
  /** Earlier severity, if it was escalated or downgraded during the incident. */
  initialSeverity?: number;
}

const SPECS: Spec[] = [
  {
    number: 1,
    title: "Login redirect loop on Safari",
    summary:
      "Users on Safari 17 were bounced between `/login` and `/callback`.\n\n- Cause: `SameSite` cookie attribute set after the redirect\n- Fix: set the attribute on the first response",
    severity: 2,
    status: "RESOLVED",
    startedAgo: 86 * DAY + 3 * HOUR,
    durationMin: 95,
    services: ["Auth", "Web App"],
    roles: { COMMANDER: person("sam"), SCRIBE: person("priya") },
    notes: ["Reproduced on Safari 17.2 only.", "Hotfix deployed; loop gone in the canary."],
  },
  {
    number: 2,
    title: "Search results stale after reindex",
    summary: "New products took up to an hour to appear in search after the nightly reindex.",
    severity: 1,
    status: "RESOLVED",
    startedAgo: 80 * DAY + 9 * HOUR,
    durationMin: 40,
    services: ["Search"],
    roles: { COMMANDER: person("priya") },
  },
  {
    number: 3,
    title: "Checkout API timeouts",
    summary:
      "Checkout requests timed out for roughly 12% of customers.\n\n## What happened\n\nConnection pool exhaustion on the primary database after a slow query shipped with the 14:05 release.\n\n## Fix\n\nRolled back the release and added a statement timeout.",
    severity: 4,
    status: "RESOLVED",
    startedAgo: 71 * DAY + 5 * HOUR,
    durationMin: 154,
    services: ["Checkout API", "Database"],
    roles: { COMMANDER: person("riley"), SCRIBE: person("sam"), COMMS: person("morgan") },
    notes: [
      "p99 latency 9.2s, error rate 12%.",
      "Rolled back release 4812.",
      "Pool saturation confirmed; added a 5s statement timeout.",
    ],
  },
  {
    number: 4,
    title: "Email notifications delayed",
    summary:
      "Transactional emails arrived 30 to 90 minutes late because the queue worker was stuck on a poison message.",
    severity: 2,
    status: "RESOLVED",
    startedAgo: 63 * DAY + 2 * HOUR,
    durationMin: 220,
    services: ["Notifications"],
    roles: { COMMANDER: person("diego"), SCRIBE: person("priya") },
  },
  {
    number: 5,
    title: "Payment webhook failures",
    summary:
      "Webhooks from the payment provider returned 500s, so orders stayed in *pending*.\n\nRoot cause was an expired signing secret after a key rotation.",
    severity: 3,
    status: "RESOLVED",
    startedAgo: 55 * DAY + 7 * HOUR,
    durationMin: 75,
    services: ["Payments"],
    roles: { COMMANDER: person("sam"), COMMS: person("riley") },
    notes: ["Provider dashboard shows 100% 5xx from us since 08:10."],
  },
  {
    number: 6,
    title: "Database failover during maintenance",
    summary:
      "A planned minor-version upgrade triggered an unplanned failover. Writes were unavailable for several minutes and a few services did not reconnect until restarted.\n\n- Impact: all write paths\n- Follow-up: connection retry settings are inconsistent between services",
    severity: 5,
    initialSeverity: 4,
    status: "RESOLVED",
    startedAgo: 47 * DAY + 4 * HOUR,
    durationMin: 312,
    services: ["Database", "API Gateway", "Checkout API", "Web App"],
    roles: { COMMANDER: person("morgan"), SCRIBE: person("riley"), COMMS: person("priya") },
    notes: ["Escalating: writes are failing everywhere.", "Replica promoted; restarting stuck services one by one."],
  },
  {
    number: 7,
    title: "Image uploads failing for large files",
    summary: "Uploads over 8 MB failed with a 413 after a proxy config change.",
    severity: 3,
    status: "RESOLVED",
    startedAgo: 38 * DAY + 11 * HOUR,
    durationMin: 130,
    services: ["API Gateway", "Web App"],
    roles: { COMMANDER: person("diego") },
  },
  {
    number: 8,
    title: "Checkout API timeout spike",
    summary:
      "A shorter burst of checkout timeouts during a flash sale. Pool size was raised but the slow query from the earlier incident came back with a new index missing.",
    severity: 3,
    status: "RESOLVED",
    startedAgo: 26 * DAY + 6 * HOUR,
    durationMin: 48,
    services: ["Checkout API"],
    roles: { COMMANDER: person("sam"), SCRIBE: person("diego") },
    notes: ["Looks like the same shape as the earlier timeouts."],
  },
  {
    number: 9,
    title: "Rate limiter blocking internal traffic",
    summary: "A new rate-limit rule matched our own health checks and some internal service calls.",
    severity: 2,
    status: "RESOLVED",
    startedAgo: 19 * DAY + 8 * HOUR,
    durationMin: 33,
    services: ["API Gateway"],
    roles: { COMMANDER: person("riley") },
  },
  {
    number: 10,
    title: "Payment webhook delivery failures",
    summary:
      "Webhooks were delivered but our handler rejected a share of them, and failed deliveries were not retried because of a bad idempotency key check.\n\n1. Fix the key check\n2. Replay the missed events\n3. Alert on webhook error rate",
    severity: 4,
    status: "RESOLVED",
    startedAgo: 12 * DAY + 5 * HOUR,
    durationMin: 205,
    services: ["Payments", "Notifications"],
    roles: { COMMANDER: person("morgan"), SCRIBE: person("sam"), COMMS: person("riley") },
    notes: ["Replayed 1,284 events from the provider dashboard."],
  },
  {
    number: 11,
    title: "Search latency above 2s",
    summary:
      "Search p95 is above 2 seconds since the index grew past its shard budget. A reshard is scheduled for tonight.",
    severity: 2,
    status: "IDENTIFIED",
    startedAgo: 1 * DAY + 6 * HOUR,
    services: ["Search"],
    roles: { COMMANDER: person("priya"), SCRIBE: person("diego") },
    notes: ["Shard count is the bottleneck; query planning is fine."],
  },
  {
    number: 12,
    title: "Auth token refresh failing intermittently",
    summary: "About 2% of refresh requests return 401. Only seen on clients that were offline for more than an hour.",
    severity: 3,
    status: "INVESTIGATING",
    startedAgo: 7 * HOUR,
    services: ["Auth", "API Gateway"],
    roles: { COMMANDER: person("sam") },
  },
  {
    number: 13,
    title: "Checkout page returns 502",
    summary:
      "The checkout page is returning 502 for most customers.\n\n- Started right after the 09:40 deploy\n- Rolling back now\n- **Customer comms sent**",
    severity: 5,
    initialSeverity: 4,
    status: "MITIGATING",
    startedAgo: 3 * HOUR,
    services: ["Checkout API", "Web App", "API Gateway", "Database"],
    roles: { COMMANDER: person("riley"), SCRIBE: person("sam"), COMMS: person("morgan") },
    notes: ["Rollback to the previous release is 60% done.", "Support has a macro ready for affected customers."],
  },
  {
    number: 14,
    title: "Image CDN returning stale assets",
    summary:
      "A few product images show the old version after a catalogue update. Purge requests are being accepted but not applied.",
    severity: 1,
    status: "INVESTIGATING",
    startedAgo: 45 * MIN,
    services: ["Web App"],
    roles: { COMMANDER: person("diego") },
  },
  {
    number: 15,
    title: "Payments webhook failures again",
    summary:
      "The same symptom as the earlier webhook incidents: 5xx responses from our handler. Nobody has taken command yet.",
    severity: 4,
    status: "IDENTIFIED",
    startedAgo: 90 * MIN,
    services: ["Payments"],
    roles: {},
  },
];

const ORDER: IncidentStatus[] = ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "RESOLVED"];

export interface SeedResult {
  workspaceId: string;
  createdIncidents: number;
  skippedIncidents: number;
}

export async function seedDemo(db: PrismaClient, options: { now?: Date } = {}): Promise<SeedResult> {
  const now = options.now ?? new Date();

  // --- people ---------------------------------------------------------------------------------
  for (const p of PEOPLE) {
    await db.user.upsert({
      where: { id: p.id },
      create: { id: p.id, name: p.name, email: emailOf(p.id), emailVerified: true },
      update: {},
    });
  }

  // --- workspace ------------------------------------------------------------------------------
  const existing = await db.workspace.findUnique({ where: { slug: DEMO_SLUG } });
  const workspace =
    existing ??
    (await db.workspace.create({
      data: {
        name: "Demo Crypt",
        slug: DEMO_SLUG,
        skin: "HAUNTED",
        retroRule: { create: { minSeverity: 4, mode: "REQUIRED" } },
        postmortemTemplates: {
          create: {
            name: "Default",
            isSystem: true,
            sections: [
              { key: "CAUSE", position: 0 },
              { key: "LAST_SIGHTING", position: 1 },
              { key: "WITNESSES", position: 2 },
              { key: "LEARNED", position: 3 },
            ],
          },
        },
      },
    }));
  const workspaceId = workspace.id;

  for (const p of PEOPLE) {
    await db.membership.upsert({
      where: { workspaceId_userId: { workspaceId, userId: p.id } },
      create: { workspaceId, userId: p.id, role: p.role },
      update: {},
    });
  }

  // Optionally add your own (already signed-up) account so you can see the demo with your real login.
  const mine = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  if (mine) {
    const user = await db.user.findUnique({ where: { email: mine } });
    if (user) {
      await db.membership.upsert({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
        create: { workspaceId, userId: user.id, role: "OWNER" },
        update: {},
      });
    }
  }

  // --- services -------------------------------------------------------------------------------
  const serviceId = new Map<string, string>();
  for (const name of SERVICES) {
    const s = await db.service.upsert({
      where: { workspaceId_slug: { workspaceId, slug: slugOf(name) } },
      create: { workspaceId, name, slug: slugOf(name) },
      update: {},
    });
    serviceId.set(name, s.id);
  }

  // --- incidents ------------------------------------------------------------------------------
  let created = 0;
  let skipped = 0;
  for (const spec of SPECS) {
    const found = await db.incident.findUnique({
      where: { workspaceId_number: { workspaceId, number: spec.number } },
      select: { id: true },
    });
    if (found) {
      skipped += 1;
      continue;
    }

    const startedAt = new Date(now.getTime() - spec.startedAgo);
    const resolved = spec.status === "RESOLVED";
    const resolvedAt = resolved ? new Date(startedAt.getTime() + (spec.durationMin ?? 60) * MIN) : null;
    const span = (resolvedAt ?? now).getTime() - startedAt.getTime();
    const at = (fraction: number) => new Date(startedAt.getTime() + Math.floor(span * fraction));

    const events: Prisma.EventCreateManyInput[] = [];
    const base = { workspaceId } as const;
    const commander = spec.roles.COMMANDER ?? spec.roles.SCRIBE ?? person("morgan");
    const addEvent = (e: Omit<Prisma.EventCreateManyInput, "workspaceId" | "incidentId">) =>
      events.push({ ...base, incidentId: "", ...e });

    addEvent({
      type: "STATUS_CHANGED",
      source: "SYSTEM",
      actorId: person("morgan"),
      payload: { to: "INVESTIGATING", created: true },
      occurredAt: startedAt,
    });
    let step = 0;
    for (const [role, userId] of Object.entries(spec.roles)) {
      if (!userId) continue;
      addEvent({
        type: "ROLE_ASSIGNED",
        actorId: commander,
        payload: { role, from: null, to: userId },
        occurredAt: new Date(startedAt.getTime() + (2 + step++) * MIN),
      });
    }
    if (spec.initialSeverity && spec.initialSeverity !== spec.severity) {
      addEvent({
        type: "SEVERITY_CHANGED",
        actorId: commander,
        payload: { from: spec.initialSeverity, to: spec.severity },
        occurredAt: at(0.2),
      });
    }
    // Walk the lifecycle up to the current status.
    const reached = ORDER.indexOf(spec.status);
    let previous: IncidentStatus = "INVESTIGATING";
    ORDER.slice(1, reached + 1).forEach((to, i) => {
      const fraction = to === "RESOLVED" ? 1 : to === "IDENTIFIED" ? 0.15 : 0.5;
      addEvent({
        type: "STATUS_CHANGED",
        actorId: commander,
        payload: { from: previous, to },
        occurredAt: to === "RESOLVED" ? resolvedAt! : at(fraction + i * 0.001),
      });
      previous = to;
    });
    (spec.notes ?? []).forEach((body, i, all) => {
      addEvent({
        type: "NOTE",
        actorId: spec.roles.SCRIBE ?? commander,
        body,
        occurredAt: at(0.1 + (0.7 * (i + 1)) / (all.length + 1)),
      });
    });

    await db.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          workspaceId,
          number: spec.number,
          title: spec.title,
          summary: spec.summary,
          severity: spec.severity,
          status: spec.status,
          startedAt,
          resolvedAt,
          createdById: commander,
          services: { create: spec.services.map((name) => ({ serviceId: serviceId.get(name)! })) },
          assignments: {
            create: Object.entries(spec.roles)
              .filter(([, userId]) => userId)
              .map(([role, userId]) => ({ role: role as "COMMANDER" | "SCRIBE" | "COMMS", userId: userId! })),
          },
        },
        select: { id: true },
      });
      await tx.event.createMany({ data: events.map((e) => ({ ...e, incidentId: incident.id })) });
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: commander,
          action: "incident.created",
          targetType: "incident",
          targetId: incident.id,
          metadata: { number: spec.number, severity: spec.severity, status: spec.status, seeded: true },
          createdAt: startedAt,
        },
      });
    });
    created += 1;
  }

  // New incidents declared after seeding must not collide with the seeded numbers.
  const highest = Math.max(...SPECS.map((s) => s.number));
  await db.workspace.updateMany({
    where: { id: workspaceId, nextIncidentNumber: { lte: highest } },
    data: { nextIncidentNumber: highest + 1 },
  });

  return { workspaceId, createdIncidents: created, skippedIncidents: skipped };
}
