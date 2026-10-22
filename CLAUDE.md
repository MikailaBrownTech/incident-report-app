# The Crypt

Multi-tenant incident and postmortem tracker with a horror theme. Differentiator: postmortem quality and follow-through (revenant detection, ritual accountability). Full plan: `C:\Users\mikai\.claude\plans\cryptic-beaming-lerdorf.md`.

## Stack
Next.js App Router (TypeScript) · Tailwind v4 · shadcn/ui · Postgres (Neon) + Prisma · Better Auth (email magic link only; no social providers yet) · Zod · Vitest · Playwright (one e2e smoke test). Stripe is a stub (`Workspace.plan`). Next 16 differs from older versions: read `node_modules/next/dist/docs/` before using unfamiliar APIs.

## Commands
```
pnpm dev            # dev server
pnpm build          # production build
pnpm typecheck      # next typegen + tsc --noEmit
pnpm lint           # eslint (includes the no-hardcoded-strings rules)
pnpm check          # typecheck + lint + unit/component tests (~40s): run after every change
pnpm test           # unit + jsdom component tests only (~5s, no DB)
pnpm test:db        # DB suites (*.db.test.ts, ~60s): run when touching src/server/db, auth or workspaces; uses a throwaway schema in your Neon DB
pnpm e2e            # Playwright against a production build on :3200 + throwaway schema; run at milestone end, not per change
pnpm test:all       # check + test:db + e2e (milestone gate)
pnpm db:migrate     # prisma migrate dev (uses DIRECT_URL); regenerates the client
pnpm db:deploy      # prisma migrate deploy
pnpm seed            # demo workspace (8 services, 15 incidents over 90 days); safe to re-run. Also: pnpm db:seed
# Database: Neon (see .env.example); no local Docker needed
```

## Theme-dictionary rule (no hardcoded user-facing strings)
- Every user-facing string lives in `src/copy/` and is read via `getCopy(skin)` (server) or `useCopy()` (client).
- `src/copy/types.ts` defines `CopyDictionary`; `haunted.ts` and `professional.ts` both use `satisfies CopyDictionary`, so a missing key in either skin fails typecheck. Add new keys to the type first, then both skins.
- Parameterised text is a function (`t.ritual.overdueBy(3)`), never concatenated in components.
- Severity labels: use `severityName(t, level, workspace.severityLabels)` so workspace overrides apply.
- Empty states are arrays of variants; use `emptyMessage(t, key, seed)` (deterministic, SSR-safe).
- Zod validation messages, `aria-label`, `title`, `placeholder`, `alt` come from the dictionary too.
- ESLint enforces JSX text and those attributes under `src/app`, `src/components`, `src/features`.

## Conventions
- Tenant isolation (the core rule): app code gets data ONLY through `ctx.db` from `getWorkspaceContext(slug)` (`src/server/auth/context.ts`), which is `scopedDb(workspaceId)` (`src/server/db/tenant.ts`). It forces `workspaceId` on every read/write of a registered model, throws if a query names another workspace, and blocks the auth tables. On creates pass `workspaceId: ctx.db.$workspaceId` (Prisma's types require it; a different value throws).
  - ESLint forbids importing `@/server/db/client` and `$queryRaw`/`$executeRaw` outside `src/server/db`. Pre-workspace operations (resolve slug, create workspace, redeem invite) live in `src/server/db/root.ts`; keep it small.
  - New tenant model: add `workspaceId` + a composite FK to its parent `(id, workspaceId)`, then list it in `src/server/db/tenant-models.ts` and `tenant.db.test.ts` (a unit test fails if the registry drifts from schema.prisma).
  - Ritual owners are plain ids (history must survive a member leaving); validate "owner is a current member" on write (M4).
- Auth: Better Auth, email magic link only (no GitHub/social). Config in `src/server/auth/auth.ts`; `getSession()` for the user. Email goes through Resend when `RESEND_API_KEY` is set; otherwise in dev it is printed and saved to `.dev-outbox/`. Base URL is `APP_URL`.
- Routes: pages live under `/app/{slug}/...` (`/app` redirects to the last-used workspace via the `crypt-last-workspace` cookie); `src/proxy.ts` sends signed-out visitors to `/sign-in?callbackUrl=...`. API routes are `/api/w/{slug}/...`, `/api/workspaces`, `/api/invites/accept`; all errors use `{ error: { code, message, fieldErrors? } }` (`src/server/api/http.ts`).
- Context helpers: pages use `getWorkspaceContext(slug)` (redirects to sign-in, 404 for non-members), API routes use `getApiWorkspaceContext(slug)` (401 / 404), then `requireRole(ctx, "ADMIN")` for role gates. Never return 403 for a non-member: it must be 404.
- Audit: security-relevant changes call `writeAudit` (`src/server/audit.ts`) inside the same transaction.
- Client mutations call the API via `api()` (`src/lib/api-client.ts`), show toasts (`useToast`), and confirm destructive actions with `ConfirmDialog`.
- Permissions live in `src/server/auth/permissions.ts` (`ctx.can` / `ctx.assert`); owners-only for owner changes; the last owner can't be demoted or removed.
- `pnpm test:db` creates a random schema inside your Neon DB, applies the real migrations, and drops it; nothing touches real tables. Shell: Prisma is pinned to 7.10.1 (client + CLI must match).
- All timeline writes go through `recordEvent()` (`src/server/events`); webhook ingestion will reuse it.
- Mutations are server actions validated with Zod; pages stay thin and delegate to `src/features/<name>/`.
- "Overdue" is computed (`status != DONE AND dueDate < now`), never stored.
- Skins are `data-skin` attributes with CSS variable tokens (`src/styles/tokens.ts` mirrors `globals.css`; a test keeps them in sync).

## Accessibility
- Both skins must meet WCAG AA; `src/styles/tokens.test.ts` checks every fg/bg pair. Change a colour in both `tokens.ts` and `globals.css`.
- All animation lives inside `@media (prefers-reduced-motion: no-preference)` (tested). Fog is `aria-hidden`, `pointer-events: none`.
- Overdue and status are never conveyed by colour alone (icon + text).

## Skins: one at a time
- The app renders exactly ONE skin. `data-skin` lives only on `<html>` (set in `src/app/layout.tsx`); never add a nested `data-skin`, split view or side-by-side comparison to a real page.
- Source of truth: `Workspace.skin` inside a workspace; the `crypt-skin` cookie (default `haunted`) before login. Resolve with `getSkin()` in `src/lib/skin.ts` (inside `/w/<slug>` it reads the workspace via the path forwarded by `src/proxy.ts`).
- Switch with `<SkinToggle skin={skin} workspaceSlug={slug} />` (server action `setSkin`); inside a workspace it saves `Workspace.skin` (any member may switch) and always updates the cookie. The toggle is in the app header.
- `/dev/styleguide` is `src/app/dev/styleguide/page.dev.tsx`: it shows the active skin only (with the toggle). `.dev.tsx` is a page extension only outside production (`next.config.ts`), so it is not in production builds. Not linked from navigation.
- `pnpm e2e` (Playwright) screenshots each screen per skin to `e2e/screenshots/` and asserts a single `[data-skin]`. Add dashboard / incidents list / incident detail to `SCREENS` in `e2e/skins.spec.ts` when they exist. It reuses a running dev server on :3000 (restart it after changing `next.config.ts`).

## Testing tiers (keep the inner loop fast)
- Inner loop: `pnpm check`. Touching db/auth/members: add `pnpm test:db`. Milestone end: `pnpm test:all`.
- DB tests: keep fixtures minimal (create only the rows a test needs) and write independent tests as `it.concurrent` with their own team; Neon round trips (~40ms each) dominate.
- E2E: runs a production build (no per-route dev compiles, single process, `/dev/styleguide` must 404). Each person signs in once; reuse `storageState`. Magic links are read from `.dev-outbox/` (enabled by `E2E_OUTBOX=1`, e2e only).

## Incidents and services (M2)
- Declaring an incident is one transaction (`src/features/incidents/declare.ts`): allocate the number with Prisma's atomic `increment` on `Workspace.nextIncidentNumber` (never `max(number)+1`), create the incident and service links, write a `STATUS_CHANGED` `Event` (source SYSTEM, payload `{ to, created: true }`) and an `incident.created` audit row. To roll back, `throw` inside the transaction; returning early still commits what was already written.
- The incidents list is URL-driven: `parseListParams` (pure, `list-params.ts`) validates the query, `listIncidents` builds the query with keyset (cursor) pagination ending in `id`, and `GET /api/w/{slug}/incidents` serves "Load more". Search text is LIKE-escaped (`%` and `_` are literal).
- Severity is 1..5, enforced by the `severity_range` CHECK constraint as well as Zod. The trigram index `incident_title_trgm` is declared in `schema.prisma` so `prisma migrate dev` doesn't try to drop it.
- Service slugs are generated once and stay stable on rename. Names are unique case-insensitively per workspace.
- Incident number labels come from the copy dictionary: `INC-42` (professional), `Haunting #42` (haunted).
- Client/server boundary: a client component must never import a module that imports `@/generated/prisma/client` or `@/server/*` at runtime (type imports are fine). Keep Zod schemas and shared types in pure files (`schema.ts`, `list-params.ts`) and server logic elsewhere. `tsc` and the tests do NOT catch this; `NEXT_DIST_DIR=.next-check pnpm build` does, so run it after adding a client component that imports from `src/features`.
- Component tests (`*.test.tsx`, jsdom) cover the client UI without a browser: add `// @vitest-environment jsdom`, mock `next/navigation` and `@/lib/api-client`, and call `polyfillDialog()` from `src/test/dialog-polyfill.ts` for `<dialog>`.
- Formatting: `.prettierrc.json` sets width 120. Run prettier on the files you changed, never on whole directories (it reformats unrelated files).
- Tests that read repo files must tolerate CRLF (a Windows checkout converts line endings).

## Incident detail, soft delete and seed (M2, part 2)
- Every incident mutation lives in `src/features/incidents/update.ts` and runs in one transaction: it writes an `Event` row (actor + `{ from, to }` payload; no-ops write nothing) and, for status, severity, role and delete changes, an audit row. Title, summary and service edits are events only. To roll back, `throw` inside the transaction.
- Status rules: RESOLVED stamps `resolvedAt`; leaving RESOLVED clears it; moving between open statuses leaves it alone; the same status is a no-op. `resolvedAt` can't be set through PATCH.
- Roles: `IncidentAssignment` has one holder per (incident, role). `PUT .../roles` takes `{ COMMANDER?, SCRIBE?, COMMS? }` (id assigns, `null` unassigns); non-members are rejected, and the composite FK to `Membership` backs that up in the database.
- Soft delete: `Incident.deletedAt`. `scopedDb` adds `deletedAt: null` to every Incident read and update (pass `deletedAt` explicitly to see deleted rows). It cannot see through NESTED relation filters, so any `_count`, `groupBy` or relation `where` that reaches incidents from another model (see `listServices`, `deleteService`) must add `incident: { deletedAt: null }` itself.
- Never use `Serializable` isolation for invariants: on small tables Postgres aborts unrelated transactions with serialization failures (random 500s). Take a per-workspace row lock with `lockWorkspace` (`src/server/db/lock.ts`) instead; see `changeMemberRole` and `removeMember`.
- User-written markdown goes through `src/components/markdown.tsx` only (HTML dropped, links limited to http(s)/mailto/relative, images never loaded, headings demoted).
- Incidents list contract: `GET /api/w/{slug}/incidents?status&severity&service&q&from&to&open&sort&dir&limit&cursor` is validated strictly with Zod (400 with field errors); the page uses the lenient `parseListParams` so a stale URL still renders. 25 per page (`limit` 1-100), keyset cursor ordered by the sort column then `id`. Chips, sort and dates `push` history entries; typing `replace`s.
- Detail UI saves optimistically per field and reverts only that field on failure (`save()` in `incident-detail.tsx`), so overlapping edits don't undo each other.
- Seed: `pnpm seed` (alias of `db:seed`) creates the `demo` workspace via `src/server/seed/demo.ts`. Idempotent: an incident whose number already exists is skipped entirely, so edits and deletions survive re-runs. `SEED_OWNER_EMAIL=you@example.com` (an account that already exists) adds you as owner. Refuses `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=1`.

## Incident timeline (M3)
- Code lives in `src/features/timeline/`: `schema.ts` (pure and browser-safe: constants, view types, cursors, Zod, `canModifyNote`, `matchesFilter`), `humanize.ts` (pure; one sentence per event type, never throws on malformed payloads), `queries.ts` and `notes.ts` (server). The client component `incident-timeline.tsx` must only import the pure files.
- Mapping to the spec's names: `EventSource.USER` is MANUAL, `INTEGRATION` is WEBHOOK, `SLACK` was added. Only `USER` + `NOTE` events can be edited or deleted; every other event is immutable. No timeline event types were added (`SERVICES_CHANGED` covers link and unlink).
- `Event.occurredAt` is when it happened (user-supplied, never more than 5 minutes in the future); `createdAt` is always server time. "Added later" means they differ by more than 2 minutes. Order is `occurredAt` then `id`.
- Cursors are opaque base64url of `{t, i}` (a position, not a row), so they survive the cursor row being deleted. `GET .../events` takes `filter`, `order`, `limit` (max 100), `cursor`, or `after`.
- `Event.updatedAt` is the change marker for live refresh: `after=<iso>` returns every entry with `updatedAt > after` plus deleted note ids (read from `incident.note_deleted` audit rows) and `truncated` past 100. The client polls every 15 s (visible tab) and on focus, then applies the active filter itself.
- Editing sets `editedAt` only when body or time change; toggling the key-moment star does not. Editing writes no timeline event. Deleting is permanent and audits `{number, noteId}`, never the body.
- Seed: notes use `minutesAfterStart`; normal events have `createdAt = occurredAt`. Events written by the current seed carry `seedVersion: 2` on the first event's payload; incidents seeded by an older shape are rebuilt once, but only if no real person authored an event.

## Seeding your own account (`pnpm seed:mine`)
- `pnpm seed:mine -- --email you@example.com [workspace-slug | --workspace slug] [--reset] [--yes]` loads `prisma/seed-incidents.json` into a workspace you already belong to (logic in `src/server/seed/mine.ts`, CLI in `prisma/seed-mine.ts`). It never creates users; with no workspace it creates "The Crypt Demo" through `createWorkspaceWithOwner`, after you confirm.
- It prints the workspace and the database host/name (never credentials) and needs `yes` typed, or `--yes`. Without a terminal and without `--yes` it refuses.
- `Incident.seedKey` (slug of the fixture title, unique per workspace, null for real incidents) makes re-runs no-ops and is the only thing `--reset` deletes by. Soft-deleted seeded incidents still count as present. `--reset` only deletes (run again to reseed), keeps seeded incidents that have a postmortem, and never rewinds `nextIncidentNumber`.
- Fixture `commander`/`scribe` are indexes into: you first, then other members by membership date; out of range falls back to you. Notes are authored by the scribe (else the commander).
