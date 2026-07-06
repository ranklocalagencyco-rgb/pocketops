# PocketOps — agent contract

Multi-tenant CRM/invoicing PWA for UK trades (plumbers, sparkies, plasterers). Astro 7 SSR
on **Cloudflare Workers** (`@astrojs/cloudflare` v14 — Workers, NOT Pages), D1 + Drizzle ORM,
Tailwind 4, R2 (`env.FILES`), KV sessions, separate cron Worker in `cron/`.

**The user is a beginner learning web development.** Explain what you're doing in plain
language — no unexplained jargon. Verify everything yourself in the running app and show
proof; never ask them to "check if it works".

## Security contract — never break these

- Every table has an indexed `tenant_id`. **Every** query on tenant data goes through
  `tenantWhere` / `tenantValues` / `assertTenant` from `src/db/index.ts`. A raw
  `eq(table.id, id)` without the tenant filter is a cross-tenant data leak.
- Money/financials are role-gated with `canSeeFinancials(role)` from `src/lib/masking.ts`
  (owner/admin see; technician/apprentice get masked values). Gate both the page
  frontmatter (redirect) and any API route (403).
- Env access is `import { env } from 'cloudflare:workers'` — never `locals.runtime.env`.
- The Google Limited Use disclosure on `/privacy` must never be removed (Gmail OAuth
  verification depends on it).
- Never print secret values. Uploading secrets: PowerShell pipes add a UTF-8 BOM, so use
  Git Bash: `printf '%s' "$val" | npx wrangler secret put NAME`.

## Deploy model — the user deploys, not you

- `git push` to `main` auto-deploys the main Worker. **You commit locally; the user
  pushes.** You are permission-blocked from pushing — don't try.
- D1 migrations: `npm run db:generate` then `npm run db:apply:local`; the user runs
  `npm run db:apply:remote` (or you ask first). Always tell them when a migration
  needs applying remotely — the #1 post-deploy failure is code live, migration not.
- The cron Worker deploys **separately**: `npx wrangler deploy --config cron/wrangler.jsonc`.
  Changes under `cron/` do nothing in prod until that runs.
- Destructive prod operations (mass DELETE, `--remote` writes) need the user to confirm
  exact targets first.

## House patterns

- Settings pages: same-page intent-POST forms (hidden `intent` input, handler switch in
  frontmatter). Model: any file in `src/pages/dashboard/settings/`. New settings page →
  also add a hub card with count in `src/pages/dashboard/settings/index.astro`.
- Theme: semantic tokens only (`bg-card`, `text-dim`, `border-edge`, `bg-accent`,
  `bg-shell`…) defined in `src/styles/global.css` under `[data-app]` (light) and
  `[data-app][data-theme="dark"]`. Numbered Tailwind stops like `bg-sky-950` are remapped
  per-mode there — safe to use for status hues. Public pages (`/form`, `/approve`, `/hub`,
  `/book`, docs) have no `data-app` and stay light — the customer's side of the fence.
- Touch targets: minimum 48px (`min-h-12`) on anything tappable — trades wear gloves.
- IDs via `newId()` / `newClientToken()` from `src/lib/ids.ts`. Money is integer cents.
- SMS sends respect quiet hours: gate scheduled/automated sends with
  `withinSendingHours(tenant)` from `src/lib/quiet-hours.ts`. Direct replies to a customer
  who just contacted us are exempt.

## Before every commit

`npx astro check` must pass (0 errors), and the change must be verified live in the dev
server (see the `pocketops-dev` skill for how to run it on this machine — there are
Windows-specific traps).

Deeper machine gotchas, integration status (Stripe sandbox, Twilio trial, QuickBooks,
Gmail), and project history live in the agent memory file
`~/.claude/projects/C--Users-user--claude/memory/pocketops-project.md`.
