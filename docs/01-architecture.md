# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Astro 7 SSR + `@astrojs/cloudflare` v14 | Server-rendered pages at the edge, zero client JS by default |
| Runtime | Cloudflare Workers (git-connected, config-as-code) | See [04-deployment.md](04-deployment.md) — this is a Worker, **not** a Pages project |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM | `pocketops-db-eu`, WEUR region |
| Files | Cloudflare R2, binding `FILES` | Job photos + company documents |
| AI | Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`) | Inbox reply drafting |
| Styling | Tailwind CSS v4 (`@theme` tokens in `src/styles/global.css`) | "Forge" palette |
| PWA | `manifest.json` + network-first/cache-fallback service worker | Installable on phones; explicitly NOT native app-store apps |
| PDFs | pdf-lib | Pure JS, isolate-safe; quotes, invoices, certificates |

## Multi-tenancy (the security contract)

- Every table carries an indexed `tenant_id`.
- **All** queries go through `tenantWhere` / `tenantValues` / `assertTenant`
  in `src/db/index.ts` — never raw per-table filters. `TenantIsolationError`
  throws if a row crosses tenants.
- Sessions: HttpOnly `pocketops_session_token` cookie; PBKDF2-SHA256 password
  hashing (Web Crypto — no Node crypto in isolates); session tokens stored
  only as SHA-256 hashes.
- `src/middleware.ts` is a fail-closed gate over `/dashboard`,
  `/api/integrations`, `/api/app`, `/api/email`: 401 JSON for API requests,
  redirect to `/login` for browser navigations, cookies dropped on any error.
- Role masking: `owner`/`admin` see costs and margins; `technician`/
  `apprentice` have cost fields stripped **server-side**
  (`src/lib/masking.ts`) and are scoped to only their assigned jobs
  (list-filtered, 404 on direct URL access).

## Magic-link portals (no customer accounts)

High-entropy NanoID tokens (≥21 chars), never sequential ids:

- `/approve/[client_token]` — quote review/accept (+ deposit), invoice payment
  (full or partial), receipt, "Our credentials" documents.
- `/hub/[token]` — permanent per-customer client hub: job history, invoices,
  certificates.
- `/docs/[token]` — shared company document (insurance, quals, T&Cs).
- `/book/[slug]` — public booking form per tenant.

## Job lifecycle

`lead → quoted → approved → scheduled → in_progress → completed → invoiced →
paid` (+ `cancelled`), enforced by the `TRANSITIONS` map in `src/lib/jobs.ts`.
`recomputeTotals` applies tenant VAT (`taxRateBps`, default 20%) and CIS
reverse charge (VAT zeroed + 20% deduction on labour line items).

## UK-first defaults

GBP / `Europe/London` / 20% VAT set **explicitly at signup** (not DB column
defaults — see D1 gotcha in [03-database.md](03-database.md)). en-GB dates and
money everywhere (`fmtMoney` / `fmtDateTz`), UK vocabulary (postcode, county,
cheque, +44 placeholders), VAT number shown on invoices, CIS support for
subcontractors.

## Design system ("Forge")

Layout modelled on a dealership-CRM reference the owner supplied, with a
deliberately different palette: warm charcoal ink tokens
(`ink-950 #151210` … `ink-600 #4c4238`), molten-copper gradient
(orange-700 → orange-600 → amber-500) for KPI cards and the FAB, amber-400
accents, stone text. Desktop = fixed 240px sidebar + topbar search; mobile =
48px bottom nav + gradient "+ New job" FAB. Customer-facing portals
intentionally stay light-themed.

## Integration patterns (Workers-isolate rules)

- **Stripe:** `Stripe.createFetchHttpClient()`; webhooks MUST use
  `constructEventAsync` + `createSubtleCryptoProvider()` (sync
  `constructEvent` uses Node crypto and fails in isolates).
- **Twilio:** no Node SDK — plain `fetch` + Basic auth; inbound webhooks
  validated with HMAC-SHA1 via Web Crypto.
- **Gmail:** OAuth2 with refresh tokens, scope `gmail.modify`; only ingests
  mail from senders matching a stored customer email (spam filter).
  (Outlook/Graph plumbing exists in `lib/email.ts` but is not offered —
  Gmail-only by product decision, 2026-07-06.)
- **QuickBooks/Xero:** OAuth2, per-job ledger sync records.
- `Astro.clientAddress` throws on this adapter — use `clientIp()` from
  `src/lib/request.ts` (reads `cf-connecting-ip`).
- Env access is `import { env } from 'cloudflare:workers'`
  (`locals.runtime.env` was removed in adapter v14). Types come from
  `npx wrangler types` → `worker-configuration.d.ts`.
