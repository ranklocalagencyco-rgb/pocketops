# Pocket Ops — Project Documentation

Multi-tenant CRM / mobile-invoicing PWA for UK field-service trades (plumbers,
electricians, plasterers, painters, roofers, waste removal, carpenters,
builders, bricklayers, landscapers, locksmiths).

**Production:** https://pocketops.ranklocalagencyco.workers.dev
**Repository:** https://github.com/ranklocalagencyco-rgb/pocketops

These documents record every step taken to build and ship the system.

| Doc | Contents |
| --- | --- |
| [01-architecture.md](01-architecture.md) | Stack, multi-tenancy, security model, design system |
| [02-build-log.md](02-build-log.md) | Chronological log of everything built, by date |
| [03-database.md](03-database.md) | Tables, migrations, and D1 gotchas |
| [04-deployment.md](04-deployment.md) | Cloudflare infrastructure — every provisioning step and how deploys work |
| [05-payments-stripe-connect.md](05-payments-stripe-connect.md) | Payment architecture — money flows to each tradesman's own account |
| [06-phone-twilio-porting.md](06-phone-twilio-porting.md) | Phone system — number porting, call routing, missed-call text-back |
| [07-go-live-checklist.md](07-go-live-checklist.md) | What's done and what remains before full launch |
