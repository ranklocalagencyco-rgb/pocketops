/**
 * Two-way SMS helpers: every text in or out lands in the `messages` table so
 * the inbox shows complete threads per customer phone number.
 */
import { eq } from 'drizzle-orm';
import { tenantValues, tenantWhere, type Db } from '../db';
import { customers, messages } from '../db/schema';
import { newId } from './ids';
import { notifyTenant } from './notify';
import { sendSms } from './twilio';

export async function matchCustomerByPhone(
  db: Db,
  tenantId: string,
  phone: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(tenantWhere(customers, tenantId, eq(customers.phone, phone)))
    .limit(1);
  return row ?? null;
}

export async function logMessage(
  db: Db,
  tenantId: string,
  opts: {
    direction: 'in' | 'out';
    kind?: 'sms' | 'email';
    phone: string;
    subject?: string | null;
    body: string;
    customerId?: string | null;
    twilioSid?: string | null;
  },
): Promise<void> {
  await db.insert(messages).values(
    tenantValues(tenantId, {
      id: newId(),
      direction: opts.direction,
      kind: opts.kind ?? 'sms',
      phone: opts.phone,
      subject: opts.subject ?? null,
      body: opts.body,
      customerId: opts.customerId ?? null,
      twilioSid: opts.twilioSid ?? null,
      // Outbound messages are "read" by definition
      readAt: opts.direction === 'out' ? new Date() : null,
    }),
  );

  // Inbound SMS → push to owner/admin devices. Inbound email is handled as
  // a per-sync summary in lib/email.ts (a sync can ingest a batch).
  if (opts.direction === 'in' && (opts.kind ?? 'sms') === 'sms') {
    let who = opts.phone;
    if (opts.customerId) {
      const [c] = await db
        .select({ name: customers.name })
        .from(customers)
        .where(tenantWhere(customers, tenantId, eq(customers.id, opts.customerId)))
        .limit(1);
      if (c?.name) who = c.name;
    }
    await notifyTenant(db, tenantId, 'newMessage', {
      title: `Message from ${who}`,
      body: opts.body.slice(0, 120),
      url: '/dashboard/inbox',
      tag: `msg-${opts.phone}`,
    });
  }
}

/** Send via Twilio and record in the thread. Returns the Twilio result. */
export async function sendAndLogSms(
  db: Db,
  env: Env,
  tenantId: string,
  opts: { to: string; from: string; body: string; customerId?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const result = await sendSms(env, { to: opts.to, from: opts.from, body: opts.body });
  if (result.ok) {
    await logMessage(db, tenantId, {
      direction: 'out',
      phone: opts.to,
      body: opts.body,
      customerId: opts.customerId,
    });
  }
  return result;
}
