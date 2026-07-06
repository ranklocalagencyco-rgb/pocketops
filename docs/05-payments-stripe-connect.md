# Payments — Stripe Connect

## The model (decided 2026-07-06)

Each tenant (tradesman) connects their **own Stripe Standard account**;
Pocket Ops is the platform. Charges are **direct charges created on the
connected account**, so:

- Customer money settles straight into the tradesman's bank — the platform
  never holds funds.
- Stripe handles each business's KYC, payouts, refunds, and disputes in
  *their* dashboard. Zero platform liability.
- The platform can optionally skim a fee per payment: set `PLATFORM_FEE_BPS`
  (basis points; `100` = 1%) and `application_fee_amount` is added to every
  checkout session. Unset/0 = no fee.

This mirrors Jobber / ServiceM8 / Tradify. The alternative (one platform
Stripe account) was rejected: it makes the platform merchant-of-record for
everyone's invoices, with manual payouts and compliance exposure.

## Flow

1. **Onboarding** — Settings → Payments → "Connect Stripe" →
   `GET /api/integrations/stripe/connect` creates a Standard account
   (`stripe.accounts.create`, country GB) on first visit, stores
   `tenants.stripe_account_id`, mints a fresh Account Link and redirects to
   Stripe-hosted onboarding. Return leg
   (`/api/integrations/stripe/return`) syncs `account.charges_enabled` into
   `tenants.stripe_charges_enabled`. The Payments page also re-checks live on
   load (onboarding can finish out-of-band).
2. **Charging** — both portal checkout sites (deposit on quote acceptance;
   balance / part-payment on invoice) call
   `stripe.checkout.sessions.create(params, { stripeAccount })`.
3. **Gating** — until `stripe_charges_enabled` is true, the public portal
   hides card payment entirely and shows
   "To pay this invoice, contact {business}" instead.
4. **Webhook** — `/api/webhooks/stripe` verifies signatures with
   `constructEventAsync` + SubtleCrypto (isolate requirement), then checks
   `event.account` matches the metadata tenant's `stripe_account_id` —
   without this, one connected account could forge metadata and flip another
   tenant's jobs to paid. Payments insert is idempotent via the unique
   payment-intent column; a job flips to `paid` only when
   `sum(succeeded payments) ≥ total − CIS deduction`.

## Go-live requirements (platform side)

1. `STRIPE_SECRET_KEY` — the **platform** account's key, as a Worker secret.
2. Complete the platform's Connect profile: Stripe dashboard → Settings →
   Connect (branding, platform profile) — required before the first
   connected account can onboard.
3. Webhook endpoint must be a **Connect** endpoint: Stripe dashboard →
   Developers → Webhooks → Add endpoint →
   **"Listen to events on Connected accounts"** →
   event `checkout.session.completed` →
   URL `https://<domain>/api/webhooks/stripe` → copy its signing secret into
   the `STRIPE_WEBHOOK_SECRET` Worker secret. (A normal own-account endpoint
   will never receive the connected-account events.)
4. Optional: `PLATFORM_FEE_BPS` secret for the per-payment platform fee.

## Files

- `src/lib/stripe.ts` — fetch HTTP client, webhook crypto provider,
  `platformFeeCents`
- `src/pages/api/integrations/stripe/connect.ts` / `return.ts`
- `src/pages/dashboard/settings/payments.astro`
- `src/pages/approve/[client_token].astro` (both checkout call sites)
- `src/pages/api/webhooks/stripe.ts`
- Migration 0008 (`tenants.stripe_charges_enabled`)
