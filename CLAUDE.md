# The Crypt

Multi-tenant incident and postmortem tracker with a horror theme. Differentiator: postmortem quality and follow-through (revenant detection, ritual accountability). Full plan: `C:\Users\mikai\.claude\plans\cryptic-beaming-lerdorf.md`.

## Stack
Next.js App Router (TypeScript) · Tailwind v4 · shadcn/ui · Postgres + Prisma · Auth.js (magic link + GitHub) · Zod · Vitest · Playwright (one e2e smoke test). Stripe is a stub (`Workspace.plan`). Next 16 differs from older versions: read `node_modules/next/dist/docs/` before using unfamiliar APIs.

## Commands
```
pnpm dev            # dev server
pnpm build          # production build
pnpm typecheck      # next typegen + tsc --noEmit
pnpm lint           # eslint (includes the no-hardcoded-strings rules)
pnpm test           # unit tests (no DB needed)
pnpm test:db        # DB-backed suites (*.db.test.ts); needs TEST_DATABASE_URL, a throwaway DB
pnpm e2e            # Playwright smoke test
pnpm db:migrate     # prisma migrate dev
pnpm db:seed        # demo data (~15 incidents, 6 postmortems, 20 rituals)
pnpm db:reset       # drop, migrate, seed
docker compose up -d db   # local Postgres 16
```
Scripts for `test:db` and `db:*` arrive with the milestones that need them (M1+).

## Theme-dictionary rule (no hardcoded user-facing strings)
- Every user-facing string lives in `src/copy/` and is read via `getCopy(skin)` (server) or `useCopy()` (client).
- `src/copy/types.ts` defines `CopyDictionary`; `haunted.ts` and `professional.ts` both use `satisfies CopyDictionary`, so a missing key in either skin fails typecheck. Add new keys to the type first, then both skins.
- Parameterised text is a function (`t.ritual.overdueBy(3)`), never concatenated in components.
- Severity labels: use `severityName(t, level, workspace.severityLabels)` so workspace overrides apply.
- Empty states are arrays of variants; use `emptyMessage(t, key, seed)` (deterministic, SSR-safe).
- Zod validation messages, `aria-label`, `title`, `placeholder`, `alt` come from the dictionary too.
- ESLint enforces JSX text and those attributes under `src/app`, `src/components`, `src/features`.

## Conventions
- Tenant isolation: every tenant-model query goes through `forWorkspace(workspaceId)`; the raw Prisma client is never imported outside `src/server/db`. Obtain it via `requireWorkspace(slug)`. A registry test fails if a model with `workspaceId` is not registered. (Lands in M1.)
- All timeline writes go through `recordEvent()` (`src/server/events`); webhook ingestion will reuse it.
- Mutations are server actions validated with Zod; pages stay thin and delegate to `src/features/<name>/`.
- "Overdue" is computed (`status != DONE AND dueDate < now`), never stored.
- Skins are `data-skin` attributes with CSS variable tokens (`src/styles/tokens.ts` mirrors `globals.css`; a test keeps them in sync).

## Accessibility
- Both skins must meet WCAG AA; `src/styles/tokens.test.ts` checks every fg/bg pair. Change a colour in both `tokens.ts` and `globals.css`.
- All animation lives inside `@media (prefers-reduced-motion: no-preference)` (tested). Fog is `aria-hidden`, `pointer-events: none`.
- Overdue and status are never conveyed by colour alone (icon + text).
