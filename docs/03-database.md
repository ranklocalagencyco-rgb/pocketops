# Database

Cloudflare D1 (SQLite) via Drizzle ORM. Schema lives in `src/db/schema.ts`;
tenancy enforcement in `src/db/index.ts`.

**Production database:** `pocketops-db-eu`
id `b498084c-102f-4d78-996e-f217eccde55f`, region WEUR.

## Tables (21)

| Table | Purpose |
| --- | --- |
| `tenants` | Workspace root: currency/tz/VAT, Stripe Connect account + charges flag, Twilio number + forward number, deposit %, SMS templates |
| `users` | Roles owner/admin/technician/apprentice; `hourly_cost_cents` is SENSITIVE (masked) |
| `sessions` | SHA-256 hashed tokens only |
| `customers` | Contact + address; `portal_token` = permanent client-hub link |
| `jobs` | Lifecycle status, `client_token` magic link, totals, quote acceptance, deposits, recurrence, chase state, CIS flag |
| `job_line_items` | labor/material/fee; `unit_cost_cents` SENSITIVE |
| `signatures` | Sign-on-glass images |
| `payments` | Unique `stripe_payment_intent_id` = webhook idempotency |
| `call_events` | Answered/missed calls, text-back timestamps |
| `review_requests` | Post-payment review SMS state |
| `accounting_connections` / `ledger_sync_records` | QBO/Xero OAuth + per-job sync log |
| `messages` | Unified inbox: SMS + email, `phone` column holds the counterparty key for both |
| `email_accounts` | Gmail/Outlook OAuth tokens (SENSITIVE) |
| `job_photos` | R2-backed |
| `expenses` / `time_entries` | Job costing; time entries carry GPS lat/lng |
| `price_book_items` | Reusable line items, CSV-importable |
| `certificates` | cp12/eicr/waste_transfer/completion, JSON data, engineer details |
| `tenant_documents` | Company docs in R2, per-doc `share_token`, `show_on_portal` |
| `number_port_requests` | Port-in pipeline: PAC, account holder, status requested→submitted→scheduled→live/cancelled |

## Migrations (drizzle/)

| # | Name | Added |
| --- | --- | --- |
| 0000 | init_multitenant_foundation | Core 9-module schema |
| 0001 | tenant_comms_fields | Twilio number, review link |
| 0002 | settings_pricebook_tax | Settings hub fields, price book |
| 0003 | uk_defaults_vat | VAT number, UK defaults |
| 0004 | allinone_features | Deposits, inbox, photos, expenses, time, automations |
| 0005 | email_inbox | email_accounts, message kind/subject |
| 0006 | certs_cis_hub_gps | Certificates, CIS, staged payments, client hub, GPS |
| 0007 | tenant_documents | Document library |
| 0008 | giant_black_crow | `tenants.stripe_charges_enabled` (Stripe Connect) |
| 0009 | aspiring_iron_patriot | `number_port_requests`, `tenants.twilio_forward_number` |

Apply with:

```bash
npm run db:apply:local    # local dev database
npm run db:apply:remote   # production D1
```

## D1 gotchas learned the hard way

- **D1 ignores `PRAGMA foreign_keys=OFF` inside migrations.** drizzle-kit's
  auto-generated table-recreate migrations (produced when a column DEFAULT
  changes) fail with FK constraint errors on D1. Fix: hand-trim those
  migrations to plain `ALTER TABLE … ADD COLUMN` and set default values in
  application code (e.g. signup sets gbp/London/20% explicitly).
- A remote `wrangler d1 migrations apply` once failed with a transient
  `7403 "account not authorized"` error — the retry succeeded. Check
  `wrangler d1 list` before assuming auth is broken.
- An empty, unused `pocketops-db` (id `41deff0b-…`) sits in APAC from a
  naming collision during provisioning — it should be deleted
  (`npx wrangler d1 delete pocketops-db`).

## Backups

```bash
npx wrangler d1 export pocketops-db-eu --remote --output backup-$(date +%F).sql
```

Run this on a schedule (or before risky migrations) — D1 has time-travel
restore, but an exported SQL file is the belt to its braces.
