/**
 * Inbound SMS webhook — point the Twilio number's Messaging webhook here.
 * Replies from customers land in the two-way inbox, threaded by phone.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb } from '../../../db';
import { tenants } from '../../../db/schema';
import { logMessage, matchCustomerByPhone } from '../../../lib/messages';
import { twilioConfigured, validateTwilioSignature } from '../../../lib/twilio';

const twiml = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { 'Content-Type': 'text/xml' },
  });

export const POST: APIRoute = async ({ request }) => {
  if (!twilioConfigured(env)) return new Response('Twilio not configured', { status: 503 });

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v;

  const callbackUrl = `${env.APP_URL || new URL(request.url).origin}/api/webhooks/twilio-sms`;
  const valid = await validateTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    callbackUrl,
    params,
    request.headers.get('x-twilio-signature'),
  );
  if (!valid) return new Response('Invalid signature', { status: 403 });

  const from = params.From;
  const to = params.To;
  const body = (params.Body ?? '').slice(0, 1600);
  if (!from || !to || !body) return twiml();

  const db = createDb(env.DB);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.twilioNumber, to)).limit(1);
  if (!tenant) return twiml();

  const customer = await matchCustomerByPhone(db, tenant.id, from);
  await logMessage(db, tenant.id, {
    direction: 'in',
    phone: from,
    body,
    customerId: customer?.id,
    twilioSid: params.MessageSid ?? null,
  });

  return twiml();
};
