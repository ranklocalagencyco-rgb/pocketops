# Deployment

**Live at:** https://pocketops.ranklocalagencyco.workers.dev
**Model:** git-connected Cloudflare **Worker** (Workers Builds). Every push to
`main` builds and deploys automatically — `git push` *is* the deploy.

## The one-line mental model

`wrangler.jsonc` in the repo is the single source of truth for all bindings
(config-as-code). The Astro adapter compiles it into
`dist/server/wrangler.json` at build time, and `npx wrangler deploy` ships it.
Nothing is configured by hand in the Cloudflare dashboard.

## Provisioning steps taken (2026-07-05 → 06)

1. **Authenticated wrangler** — `npx wrangler login`
   (account `b00761ba1dd2c892b8a85ce1a1c36ad0`).
2. **Created production D1 in the EU** —
   `npx wrangler d1 create pocketops-db-eu --location weur`
   → id `b498084c-102f-4d78-996e-f217eccde55f`. (A first attempt named
   `pocketops-db` landed in APAC and was orphaned by a naming collision —
   still needs manual deletion.)
3. **Applied all migrations remotely** — `npm run db:apply:remote`.
4. **Subscribed to R2** (dashboard) and created the bucket —
   `npx wrangler r2 bucket create pocketops-files` (weur).
5. **Created the GitHub repo** (manually, empty+private:
   `ranklocalagencyco-rgb/pocketops`), then
   `git remote add origin … && git push -u origin main`.
6. **First deploy attempt: Cloudflare Pages — failed, by design.**
   The `@astrojs/cloudflare` v14 adapter emits a *Workers* deploy config
   (`main: entry.mjs` + an `ASSETS` assets binding). Pages rejected it:
   `The name 'ASSETS' is reserved in Pages projects` and
   `kv_namespaces[0] should have a string "id"`. Lesson: **this adapter
   version targets Workers, not Pages.** The failed Pages project was deleted
   (`npx wrangler pages project delete pocketops`).
7. **Created the SESSION KV namespace** (required by Astro's session support):
   `npx wrangler kv namespace create SESSION`
   → id `b4abe365e1ad493a81194cd46c4a9861`.
8. **Rewrote `wrangler.jsonc` for Workers**: removed
   `pages_build_output_dir`; bindings now = `AI` (Workers AI), `SESSION` (KV),
   `FILES` (R2), `DB` (D1). `preview` script became `wrangler dev`.
9. **Connected the repo as a git Worker** — dashboard → Workers & Pages →
   Create → Continue with GitHub → `pocketops`:
   build command `npm run build`, deploy command `npx wrangler deploy`.
   First build went green and deployed with all bindings.
10. **Set runtime secrets** (see below) and **smoke-tested production**:
    signup → tenant row in remote D1 → session cookie → dashboard rendered.
    (Test workspace "Smoke Test Co" / smoketest@pocketops.io remains in the
    production DB.)

## Secrets

Set via CLI, never committed:

```bash
echo "value" | npx wrangler secret put NAME
```

Currently set: `APP_URL` (= the workers.dev URL until the custom domain
lands), `CRON_SECRET`.

**Rule: always use secrets, not plain-text vars.** Config-as-code deploys
wipe dashboard-entered plain vars (the repo config has `vars: {}`), but
secrets survive every deploy.

Full expected list as external services come online (see
`.dev.vars.example`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`PLATFORM_FEE_BPS` (optional), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`GOOGLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET`,
`QBO_CLIENT_ID/SECRET/ENVIRONMENT`, `XERO_CLIENT_ID/SECRET`.

## Local development

```bash
npm run dev        # Astro 7 daemonizes: astro dev stop / status / logs
npm run build      # production build (also regenerates dist/server/wrangler.json)
npm run preview    # wrangler dev against the built output
```

- With wrangler logged in, the `AI` binding works in local dev (proxied to
  the real API — may incur usage charges). The old "AI binding kills astro
  dev" problem only applies when logged out.
- Recurring dev nuisance: stale Vite dep cache
  (`.vite/deps_ssr/stripe.js missing`) 500s pages that import stripe after
  config changes — restart the dev server.
- Astro enforces CSRF origin checks on POSTs — curl tests need
  `-H "Origin: http://localhost:4321"`.

## Deploy checklist for future changes

1. Schema change? `npm run db:generate`, inspect the SQL (plain ALTERs only —
   see D1 gotchas), `npm run db:apply:local`, **`npm run db:apply:remote`
   before pushing** (deploys are automatic; code must never land before its
   migration).
2. `npx astro check` + `npm run build` clean.
3. Commit, push — Workers Builds does the rest (~2 min).
