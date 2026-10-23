import type { Fixture } from "./mine";
import type { SeedPostmortem } from "./postmortems";

/**
 * Which fixture incidents get a postmortem when seeding your own account, and what it says.
 *
 * - Published: the database failover and the first checkout timeouts.
 * - Drafts (partly filled): the first payment webhook failures and the search index lag.
 * - Deliberately none: "Login failures for SSO users" and "Checkout API timeout spike" (severity 4, resolved), so
 *   they show up OVERDUE.
 * - DUE_SOON: no other severity 4+ incident is left once those are placed, so "Web app blank page after deploy" is the
 *   one given a postmortem-less, recently resolved state (see DUE_SOON_KEY).
 */

/** Resolved this many days ago when first seeded, so its 5-day deadline is about a day away. */
export const DUE_SOON_KEY = "web-app-blank-page-after-deploy";
export const DUE_SOON_RESOLVED_DAYS_AGO = 4;

const stamp = (m: number) => `+${Math.floor(m / 60) ? `${Math.floor(m / 60)}h ` : ""}${m % 60}m`;

export function seedPostmortemsFor(fixture: Fixture): Map<string, SeedPostmortem> {
  const byTitle = (title: string) => {
    const incident = fixture.incidents.find((i) => i.title === title);
    if (!incident) throw new Error(`seed fixture has no incident "${title}"`);
    return incident;
  };
  const timeline = (title: string) =>
    byTitle(title).notes.map((n) => `${stamp(n.minutesAfterStart)} after the start: ${n.body}`);

  const flash = byTitle("Checkout API timeouts during flash sale");
  const failover = byTitle("Database primary failover");
  const webhooks = byTitle("Payment webhook failures");
  const lag = byTitle("Search index lag after reindex");

  const key = (title: string) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

  return new Map<string, SeedPostmortem>([
    [
      key(flash.title),
      {
        status: "PUBLISHED",
        sections: {
          summary: flash.summary,
          impact:
            "About 12% of carts failed at the payment step for roughly an hour and a half during the busiest sale of the quarter. No payments were double-charged.",
          root_cause: [
            flash.rootCause ?? "",
            "The pool was sized for normal traffic and had no headroom for a tripling of requests.",
            "Reporting queries shared the primary with checkout, so they competed for the same connections.",
          ].filter(Boolean),
          detection:
            "The pool saturation alarm fired within ten minutes. Customers reported failures at about the same time, so the alarm was not noticeably ahead of them.",
          response:
            "The on-call engineer raised the pool size and moved read-only queries to the replica. Error rate returned to baseline within an hour.",
          timeline: timeline(flash.title),
          went_well: "The replica was ready to take read traffic, and the change needed no deploy.",
          went_wrong: "Nobody had load-tested checkout at the traffic level the sale marketing predicted.",
          lucky: "The sale ran on a weekend, when internal reporting jobs were quiet.",
          lessons: [
            "Load-test checkout against the forecast for every sale.",
            "Give reporting queries their own replica so they cannot compete with checkout.",
            "Alert on pool utilisation well before saturation.",
          ],
        },
      },
    ],
    [
      key(failover.title),
      {
        status: "PUBLISHED",
        sections: {
          summary: failover.summary,
          impact:
            "Writes were unavailable for several minutes, and many requests errored across the product until the application servers were restarted.",
          root_cause: [
            failover.rootCause ?? "",
            "The failover itself did what it should. The gap was that application connection pools kept dead connections and did not retry on a fresh one.",
          ].filter(Boolean),
          detection: "Automatic failover and the error-rate alarm fired together, within a minute of the fault.",
          response:
            "The replica was promoted automatically. Application servers were restarted in a rolling fashion until every one held a live connection.",
          timeline: timeline(failover.title),
          went_well: "Failover was automatic, and the data was intact with no loss.",
          went_wrong: "Reconnecting needed a manual rolling restart, which added most of the downtime.",
          lucky: "The fault happened during a low-traffic period.",
          lessons: [
            "Configure connection pools to validate and replace connections after a failover.",
            "Run a failover drill each quarter, including the application side.",
          ],
        },
      },
    ],
    [
      key(webhooks.title),
      {
        status: "DRAFT",
        sections: {
          summary: webhooks.summary,
          impact:
            "Orders stayed in pending although customers had been charged. Support received a steady stream of questions until reprocessing finished.",
          root_cause: webhooks.rootCause ?? "",
        },
      },
    ],
    [
      key(lag.title),
      {
        status: "DRAFT",
        sections: {
          summary: lag.summary,
          root_cause: lag.rootCause ?? "",
        },
      },
    ],
  ]);
}
