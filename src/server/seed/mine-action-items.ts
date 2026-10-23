import type { SeedActionItem } from "./action-items";

/**
 * Action items for the four seeded postmortems (`seedKey` is the slug of the incident title). Twenty in all:
 * 6 done, 5 in progress, 5 open with a date, 2 open without one, 2 won't do. Four are overdue (3, 4, 8 and 13 below),
 * three are due within three days. Owner 0 is you; the rest are the workspace's other members, in a stable order.
 */
export const MINE_ACTION_ITEMS: Record<string, SeedActionItem[]> = {
  "checkout-api-timeouts-during-flash-sale": [
    {
      title: "Load-test checkout against the forecast for every sale",
      owner: 0,
      status: "DONE",
      dueInDays: -65,
      completedDaysAgo: 60,
    },
    {
      title: "Move reporting queries to a dedicated read replica",
      owner: 1,
      status: "DONE",
      dueInDays: -52,
      completedDaysAgo: 50,
    },
    {
      title: "Add an alert on database pool utilisation well before saturation",
      description: "Page at 70% of the pool, not at 100%.",
      owner: 2,
      status: "IN_PROGRESS",
      dueInDays: -1,
    },
    {
      title: "Raise the default connection pool size and document the limit",
      owner: 0,
      status: "IN_PROGRESS",
      dueInDays: -3,
    },
    {
      title: "Write a runbook for connection pool exhaustion",
      owner: 1,
      status: "WONT_DO",
      dueInDays: null,
      reason: "Covered by the new database on-call guide",
    },
    { title: "Agree an error budget for checkout latency", owner: 2, status: "OPEN", dueInDays: null },
  ],
  "database-primary-failover": [
    {
      title: "Configure connection pools to validate and replace connections after a failover",
      owner: 0,
      status: "DONE",
      dueInDays: -30,
      completedDaysAgo: 5,
    },
    { title: "Alert when a replica is promoted", owner: 1, status: "DONE", dueInDays: -36, completedDaysAgo: 3 },
    {
      title: "Run a quarterly failover drill that includes the application servers",
      owner: 1,
      status: "IN_PROGRESS",
      dueInDays: 2,
    },
    { title: "Standardise connection retry settings across services", owner: 0, status: "OPEN", dueInDays: -6 },
    { title: "Add a failover section to the on-call handbook", owner: 2, status: "OPEN", dueInDays: 14 },
  ],
  "payment-webhook-failures": [
    {
      title: "Deploy rotated secrets to every instance through the config service",
      owner: 2,
      status: "DONE",
      dueInDays: -72,
      completedDaysAgo: 70,
    },
    {
      title: "Add a startup check that fails when the webhook secret is missing",
      owner: 0,
      status: "IN_PROGRESS",
      dueInDays: 1,
    },
    { title: "Alert on webhook signature failures above 1%", owner: 1, status: "OPEN", dueInDays: -2 },
    { title: "Document the secret rotation procedure", owner: 0, status: "OPEN", dueInDays: 21 },
    {
      title: "Build an admin page to replay failed webhooks",
      owner: 2,
      status: "WONT_DO",
      dueInDays: null,
      reason: "The provider dashboard already covers replays",
    },
  ],
  "search-index-lag-after-reindex": [
    {
      title: "Give the incremental updater dedicated workers",
      owner: 1,
      status: "DONE",
      dueInDays: -60,
      completedDaysAgo: 9,
    },
    {
      title: "Schedule reindex jobs outside the incremental updater's peak window",
      owner: 2,
      status: "IN_PROGRESS",
      dueInDays: 10,
    },
    { title: "Add an index freshness dashboard with a 5 minute alert", owner: 0, status: "OPEN", dueInDays: 3 },
    { title: "Review whether the reindex can run incrementally", owner: 1, status: "OPEN", dueInDays: null },
  ],
};
