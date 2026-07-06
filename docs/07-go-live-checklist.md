# Go-Live Checklist

Status as of 2026-07-06.

## ✅ Done

- [x] Full application built and verified (see [02-build-log.md](02-build-log.md))
- [x] Production D1 `pocketops-db-eu` (WEUR), all 10 migrations applied
- [x] R2 bucket `pocketops-files` (weur)
- [x] SESSION KV namespace
- [x] GitHub repo + Workers Builds CI: **git push = deploy**
- [x] All bindings config-as-code (AI, SESSION, FILES, DB) — including
      Workers AI, so the ✨ reply drafter works in production
- [x] `APP_URL` + `CRON_SECRET` Worker secrets
- [x] Live at https://pocketops.ranklocalagencyco.workers.dev — production
      smoke test passed (signup → D1 write → session → dashboard)
- [x] Stripe Connect architecture (tenants' own accounts, portal gating,
      cross-tenant webhook guard)
- [x] Twilio porting intake + CRM-controlled call routing

## 🔜 Remaining

### Infrastructure

- [ ] **Custom domain** — attach `pocketops.io` to the Worker (dashboard →
      pocketops → Settings → Domains & Routes), then update the `APP_URL`
      secret to `https://pocketops.io`. APP_URL drives OAuth callbacks,
      Twilio signature URLs, and every magic link, so do this before
      onboarding real clients.
- [ ] **Daily automations trigger** — a tiny scheduled Worker (cron
      `0 7 * * *`) that POSTs to `https://<domain>/api/cron/daily` with
      `Authorization: Bearer <CRON_SECRET>`. Drives invoice chasing,
      recurring-job spawning, and email sync.
- [ ] Delete the orphaned APAC database:
      `npx wrangler d1 delete pocketops-db` (id `41deff0b-…`)
- [ ] Cloudflare WAF rate-limit rule on `/login`
- [ ] D1 backup habit (see [03-database.md](03-database.md))
- [ ] Remove or keep the "Smoke Test Co" test workspace in production

### External services (each lights its feature up when its secrets land)

> **Note:** the OAuth client ids/secrets below are *developer app
> registrations*, not accounts. Clients always connect their **own**
> QuickBooks/Xero books, their **own** Gmail mailbox, and their
> **own** Stripe account — the platform just registers the app that makes
> those connections possible.

- [ ] **Stripe** — platform account, Connect profile, `STRIPE_SECRET_KEY`,
      Connect webhook + `STRIPE_WEBHOOK_SECRET`, optional `PLATFORM_FEE_BPS`
      → [05-payments-stripe-connect.md](05-payments-stripe-connect.md)
- [ ] **Twilio** — account, UK regulatory bundle, `TWILIO_ACCOUNT_SID` +
      `TWILIO_AUTH_TOKEN` → [06-phone-twilio-porting.md](06-phone-twilio-porting.md)
- [x] **Google OAuth app** (Gmail inbox) — done 2026-07-06: project
      `trusty-axe-501601-g1`, client "Pocket Ops Web", secrets set on the
      Worker. App is in **Testing** mode: only test users
      (ranklocalagencyco@gmail.com, aisurulabs@gmail.com) can connect until
      Google's restricted-scope verification is passed — add pilot clients as
      test users meanwhile, and add the pocketops.io redirect URI when the
      domain lands.
- ~~Microsoft Entra app (Outlook inbox)~~ — **dropped 2026-07-06**: the
      product is Gmail-only (Outlook plumbing stays dormant in lib/email.ts;
      MS_CLIENT_ID/SECRET intentionally never set)
- [ ] **QuickBooks** — free developer app at developer.intuit.com →
      `QBO_CLIENT_ID/SECRET`, `QBO_ENVIRONMENT=production`. Each tenant then
      connects their own QuickBooks company from Settings → Accounting.
- [ ] **Xero** — free developer app at developer.xero.com →
      `XERO_CLIENT_ID/SECRET`. Each tenant connects their own Xero
      organisation from Settings → Accounting.

### Product / legal

- [ ] Privacy policy + terms pages (required by Google OAuth verification and
      by Stripe/Twilio for business verification)
- [ ] Real-phone end-to-end test once the domain is live: signup → job →
      quote → magic link → accept + deposit → invoice → real card payment →
      refund → certificate PDF → review SMS
- [ ] Platform-owner admin view for port requests and tenant management
      (currently: direct D1 queries)
