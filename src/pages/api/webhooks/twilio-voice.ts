/**
 * CRM-controlled call routing. Set as the Twilio number's Voice URL: every
 * inbound call asks Pocket Ops what to do, and we <Dial> the tenant's
 * forwarding handset (Settings → Messaging). The <Dial action> points at the
 * status webhook, whose DialCallStatus decides missed-call text-back — so
 * routing changes never need a Twilio console visit.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb } from '../../../db';
import { tenants } from '../../../db/schema';
import { twilioConfigured, validateTwilioSignature } from '../../../lib/twilio';

const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });

export const POST: APIRoute = async ({ request }) => {
  if (!twilioConfigured(env)) return new Response('Twilio not configured', { status: 503 });

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v;

  const base = env.APP_URL || new URL(request.url).origin;
  const valid = await validateTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    `${base}/api/webhooks/twilio-voice`,
    params,
    request.headers.get('x-twilio-signature'),
  );
  if (!valid) return new Response('Invalid signature', { status: 403 });

  const to = params.To;
  if (!to) return xml('');

  const db = createDb(env.DB);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.twilioNumber, to)).limit(1);
  if (!tenant) return xml('');

  // Strip to +digits — the number is tenant-entered and lands inside TwiML
  const forward = (tenant.twilioForwardNumber || tenant.phone || '').replace(/[^+\d]/g, '');
  if (!forward) {
    return xml(
      '<Say language="en-GB">Sorry, we cannot take your call right now. Please send us a text and we will get straight back to you.</Say>',
    );
  }

  // answerOnBridge keeps ringback playing until the handset actually answers;
  // 20s timeout beats most mobile voicemails to the punch so the text-back
  // fires instead of voicemail swallowing the lead.
  return xml(
    `<Dial answerOnBridge="true" timeout="20" action="${base}/api/webhooks/twilio" method="POST"><Number>${forward}</Number></Dial>`,
  );
};
