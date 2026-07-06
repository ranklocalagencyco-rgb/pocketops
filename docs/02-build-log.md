# Build Log

Chronological record of everything built, in the order it happened.

## 2026-07-04 — Core system (Modules 1–9)

1. **DB foundation** — Drizzle schema, tenant isolation helpers, migration 0000.
2. **Auth** — signup/login, PBKDF2 passwords, hashed session tokens,
   fail-closed middleware.
3. **PWA** — manifest + network-first service worker.
4. **Job lifecycle** — lead→paid state machine, jobs list/detail/new pages.
5. **Sign-on-glass** — canvas signature capture stored per job.
6. **Magic-link payment portal** — `/approve/[client_token]` with Stripe
   Checkout (Apple Pay / Google Pay / card).
7. **Missed-call text-back** — Twilio voice webhook, signature-validated.
8. **Review loop** — review SMS fires on payment (shared
   `src/lib/post-payment.ts`).
9. **Accounting sync** — QuickBooks Online + Xero OAuth, invoice push on paid.

Verified end-to-end in dev: signup → job → invoice → public portal payment;
role masking (technician never receives cost fields in HTML); 403/404/503
edge cases.

## 2026-07-04 — UI restyle ("Forge")

Rebuilt the dashboard to match a reference CRM screenshot's *layout* with an
original palette (owner: "use a different colour scheme … don't copy it like
for like"): sidebar + topbar with working search, 4 gradient KPI cards,
pipeline bars per stage, Today panel, recent-jobs table with stage pills,
greeting in tenant timezone.

## 2026-07-04 — Settings backend (migration 0002)

Card-grid settings hub with live count badges — every subpage functional, not
cosmetic: Business, Regional & VAT, Team, Price Book, Messaging, Reviews,
Payments, Accounting. VAT applies through `recomputeTotals`; price book
quick-adds line items on jobs; SMS templates ({name}/{link}) drive the Twilio
webhook and review texts.

## 2026-07-04 — UK localisation (migration 0003)

GBP/London/20% VAT signup defaults, VAT labelling + VAT number on invoices,
en-GB formatting, UK vocabulary and +44 placeholders.

## 2026-07-04 — All-in-one expansion (migration 0004)

- Quote acceptance + deposits on the portal (deposit % in Regional settings)
- Week-diary schedule at `/dashboard/schedule` (timezone-keyed math)
- Two-way SMS inbox `/dashboard/inbox` + inbound webhook, unread badge
- Job photos via R2 (`/api/app/photos`)
- pdf-lib quote/invoice PDFs (`/api/app/pdf/[jobId]`)
- Daily automations `/api/cron/daily` (Bearer `CRON_SECRET`): invoice chasing
  (7-day intervals, max 3) + recurring-job spawning + heads-up SMS
- Expenses + time entries + job-profit card
- Reminder and on-my-way texts; public booking form `/book/[slug]`

## 2026-07-04 — Unified email inbox (migration 0005)

Gmail + Outlook OAuth (`/api/email/[provider]/connect|callback` — Outlook was
later dropped from the product on 2026-07-06; Gmail-only), messages
table gained `kind` ('sms'|'email') + `subject`; email threads join the same
inbox; replies auto-route out through the connected mailbox (SMS via Twilio).
Sync on demand + via daily cron. Only ingests senders matching a customer's
stored email.

## 2026-07-05 — Super-app expansion (migration 0006)

Driven by competitor research (Jobber client hub, ServiceM8 automation,
Tradify markup, Powered Now UK certificates):

- **Digital certificates engine** — CP12, EICR, waste transfer, completion;
  templated forms + generic PDF renderer; public download via client hub
- **CIS reverse charge** — per-job toggle: VAT zeroed, 20% labour deduction,
  reverse-charge note on the portal
- **Staged payments** — portal accepts part-payments; job flips to paid only
  when balance fully covered; idempotent webhook (unique payment-intent)
- **Client hub** — permanent per-customer portal (`/hub/[token]`)
- **Price book CSV import** with markup % calculation
- **Route planning** — multi-stop Google Maps link from today's jobs
- **GPS-stamped clock-in** (best-effort geolocation, never blocks)
- **AI reply drafter** — Workers AI, ✨ button in the inbox

## 2026-07-05 — Company document library (migration 0007)

R2-backed uploads (insurance, qualifications, T&Cs — ≤10MB, owner/admin
only), per-document share links (`/docs/[token]`), and a `showOnPortal`
toggle that surfaces documents as "Our credentials" on quote portals and
client hubs.

## 2026-07-05 — Infrastructure provisioning

Cloudflare auth, D1 production database (EU), R2 bucket. Full detail in
[04-deployment.md](04-deployment.md).

## 2026-07-06 — Stripe Connect (migration 0008)

Rebuilt payments as a platform: each tenant onboards their own Stripe
Standard account; charges are created **on their account** so money never
touches the platform. Full detail in
[05-payments-stripe-connect.md](05-payments-stripe-connect.md).

## 2026-07-06 — Production deployment

GitHub → Cloudflare Workers Builds; first Pages attempt failed and was
replaced by a Workers deploy. App live and smoke-tested at the edge. Full
detail in [04-deployment.md](04-deployment.md).

## 2026-07-06 — Number porting + CRM call routing (migration 0009)

Porting-first phone strategy for established trades; CRM-controlled call
routing with `<Dial>`; hang-up-while-ringing now counts as a missed call.
Full detail in [06-phone-twilio-porting.md](06-phone-twilio-porting.md).
