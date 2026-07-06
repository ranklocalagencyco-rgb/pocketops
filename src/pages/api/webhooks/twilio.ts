/**
 * Automated Missed-Call Text-Back (Module 7).
 * Receives either the <Dial action> callback from /api/webhooks/twilio-voice
 * (DialCallStatus — the routed-call flow) or a number's voice status callback
 * (CallStatus — legacy direct setup). Signature-validated so it can't be
 * abused as a free SMS relay.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantValues, tenantWhere } from '../../../db';
import { callEvents, customers, tenants } from '../../../db/schema';
import { newId } from '../../../lib/ids';
import { sendSms, twilioConfigured, validateTwilioSignature } from '../../../lib/twilio';

// 'canceled' = the caller gave up while it was still ringing — exactly the
// lead the text-back exists to save
const MISSED_STATUSES = new Set(['no-answer', 'busy', 'failed', 'canceled']);

const twiml = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { 'Content-Type': 'text/xml' },
  });

export const POST: APIRoute = async ({ request }) => {
  if (!twilioConfigured(env)) return new Response('Twilio not configured', { status: 503 });

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v;

  const callbackUrl = `${env.APP_URL || new URL(request.url).origin}/api/webhooks/twilio`;
  const valid = await validateTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    callbackUrl,
    params,
    request.headers.get('x-twilio-signature'),
  );
  if (!valid) return new Response('Invalid signature', { status: 403 });

  const callSid = params.CallSid;
  const from = params.From;
  const to = params.To;
  // DialCallStatus (dial-action flow) is the handset outcome; CallStatus alone
  // means a legacy status-callback setup
  const isDialAction = 'DialCallStatus' in params;
  const callStatus = (params.DialCallStatus ?? params.CallStatus ?? '').toLowerCase();
  if (!callSid || !from || !to) return twiml();

  const db = createDb(env.DB);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.twilioNumber, to)).limit(1);
  if (!tenant) return twiml();
  const tenantId = tenant.id;

  const missed = MISSED_STATUSES.has(callStatus);
  const [match] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(tenantWhere(customers, tenantId, eq(customers.phone, from)))
    .limit(1);

  try {
    await db.insert(callEvents).values(
      tenantValues(tenantId, {
        id: newId(),
        twilioCallSid: callSid,
        fromNumber: from,
        toNumber: to,
        status: missed ? 'missed' : 'answered',
        matchedCustomerId: match?.id ?? null,
      }),
    );
  } catch {
    return twiml(); // duplicate CallSid — status callback replay, nothing to do
  }

  if (missed) {
    // Custom template from Settings → Messaging; {name} supported
    const template = tenant.missedCallMessage?.trim();
    const firstName = match?.name.split(/\s+/)[0];
    const greeting = firstName ? `Hi ${firstName}, sorry` : 'Sorry';
    const body = template
      ? template.replaceAll('{name}', firstName ?? 'there')
      : `${greeting} we missed your call — this is ${tenant.name}. We're likely on a job. Reply here and we'll get right back to you!`;
    const result = await sendSms(env, {
      to: from,
      from: to,
      body,
    });
    if (result.ok) {
      await db
        .update(callEvents)
        .set({ textBackSentAt: new Date() })
        .where(tenantWhere(callEvents, tenantId, eq(callEvents.twilioCallSid, callSid)));
    }
    // Dial-action responses play to the still-connected caller — tell them
    // help is already on its way before hanging up
    if (isDialAction) {
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-GB">Sorry, we could not get to the phone. We have just sent you a text — reply there and we will get straight back to you.</Say></Response>',
        { headers: { 'Content-Type': 'text/xml' } },
      );
    }
  }

  return twiml();
};
