# Phone System — Twilio, Porting, Call Routing

## The model (decided 2026-07-06)

- **One platform Twilio account** (the `TWILIO_ACCOUNT_SID` /
  `TWILIO_AUTH_TOKEN` secrets), one number per tenant. Unlike Stripe — where
  the money is theirs so the account must be theirs — comms is a platform
  utility, priced into the subscription. This is how Jobber/ServiceM8 do it.
- Inbound webhooks map the `To` number → `tenants.twilio_number` to find the
  tenant.
- **Porting-first strategy**: target customers are established businesses
  whose number is already on the van, Checkatrade, and ten years of Google
  listings — so they port that number *into* Twilio and nothing published
  ever changes. (Buying fresh numbers stays possible for new businesses.)

## How a call flows

1. Customer calls the business number (from website / Checkatrade / GBP /
   van — no "integration" needed; the routing *is* the number).
2. Twilio hits `POST /api/webhooks/twilio-voice` (the number's **Voice URL**).
   The CRM looks up the tenant and returns
   `<Dial answerOnBridge timeout="20" action="/api/webhooks/twilio">` to the
   tenant's **forward number** (`tenants.twilio_forward_number`, falling back
   to `tenants.phone`). 20s beats most mobile voicemails so the text-back
   gets the lead instead of voicemail.
3. When the dial ends, Twilio calls the action URL with `DialCallStatus`.
   `no-answer`, `busy`, `failed`, and `canceled` (caller hung up while
   ringing — still a lead!) count as **missed**: the call is logged, the
   still-connected caller hears "we've just sent you a text", and the
   text-back SMS fires from the business number (custom template with
   `{name}` support).
4. Replies land in the unified inbox (`/api/webhooks/twilio-sms` is the
   number's **Messaging URL**); outbound SMS (reminders, on-my-way, review
   requests, invoice chasing) all send from the same number.

Because routing decisions live in the CRM, changing a forward number is a
Settings edit — no Twilio console visit per client.

## Porting: what the app does

Settings → Messaging ("Bring your existing number with you") collects a
complete port request into `number_port_requests`:

- number + type (mobile / landline)
- **PAC code** for mobiles (UI tells them: text `PAC` to `65075`, free)
- account holder name, current provider
- Mobile warning shown up front: *their handset gets a new SIM number; the
  ported number becomes the business line; texts to it arrive in the Pocket
  Ops inbox, not their messages app* — great for a work number, wrong choice
  if it's also their personal number (bank OTPs etc.). Those clients should
  use a fresh number + conditional divert instead.

The tenant sees a status timeline: **Requested → Submitted → Scheduled
(+date) → Live**, and can cancel while still at Requested.

## Porting: what the platform owner does (manual — cannot be API-automated)

1. One-time: complete Twilio's **UK regulatory bundle** (address
   verification) — required before Twilio will host UK numbers.
2. When a request lands: file the port with Twilio (console → Phone Numbers →
   Port & Host). Mobiles use the PAC; landlines need a signed Letter of
   Authorization + recent bill. UK ports take ~1–4 weeks; the number keeps
   working throughout.
3. Advance the request status as it progresses so the tenant's tracker
   updates (no admin UI yet — update the row directly):

   ```bash
   npx wrangler d1 execute pocketops-db-eu --remote --command \
     "UPDATE number_port_requests SET status='submitted', updated_at=unixepoch() WHERE id='<request-id>'"
   ```

4. When the port completes: set the number's **Voice URL** to
   `https://<domain>/api/webhooks/twilio-voice` and **Messaging URL** to
   `https://<domain>/api/webhooks/twilio-sms` (both POST), fill the tenant's
   `twilio_number`, mark the request `live`.
5. Make sure the tenant has set "Ring through to" (their new SIM's number for
   mobile ports).

## Alternatives to porting (for clients it doesn't suit)

- **Conditional divert** — keep their existing mobile public; set
  divert-on-no-answer/busy to a rented Twilio number (`*61*<number>#`-style
  short code, 30 seconds to set up). Only missed calls flow through the CRM.
- **Fresh number** — rent a GB number (~£1–2/mo; must be **GB Mobile** if SMS
  is needed — UK local numbers are voice-only on Twilio) and update listings
  over time.

## Security

All three webhooks validate `X-Twilio-Signature` (HMAC-SHA1 over URL + sorted
params, constant-time compare) so they can't be used as a free SMS cannon.

## Files

- `src/lib/twilio.ts` — sendSms, signature validation
- `src/pages/api/webhooks/twilio-voice.ts` — call routing (Voice URL)
- `src/pages/api/webhooks/twilio.ts` — missed-call detection + text-back
  (Dial action / legacy status callback)
- `src/pages/api/webhooks/twilio-sms.ts` — inbound SMS → unified inbox
- `src/pages/dashboard/settings/messaging.astro` — port intake, tracker,
  routing settings
- Migration 0009 (`number_port_requests`, `tenants.twilio_forward_number`)
