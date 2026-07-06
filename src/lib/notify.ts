/**
 * Push notification fan-out. Call from the event that just happened
 * (webhook, portal action, booking form, cron) — failures are swallowed:
 * a push must never break the payment/webhook that triggered it.
 *
 * Two shapes:
 *  - notifyTenant: broadcast a business event to every qualifying device.
 *    Money/business categories go to owner/admin only (same server-side
 *    gate as financial masking).
 *  - notifyUser: target one person (job assigned to them, their own
 *    tomorrow digest) — role-independent, only their pref applies.
 */
import { env } from 'cloudflare:workers';
import { eq, inArray } from 'drizzle-orm';
import { tenantWhere, type Db } from '../db';
import { pushSubscriptions, users } from '../db/schema';
import { canSeeFinancials } from './masking';
import { pushConfigured, sendWebPush, type PushPayload } from './webpush';

export type PushCategory =
  | 'missedCall'
  | 'newMessage'
  | 'quoteAccepted'
  | 'payment'
  | 'newLead'
  | 'jobAssigned'
  | 'tomorrowDigest'
  | 'invoiceChased'
  | 'staleLeads';

type UserRow = typeof users.$inferSelect;

const PREF_COLUMN: Record<PushCategory, (u: UserRow) => boolean> = {
  missedCall: (u) => u.notifyMissedCall,
  newMessage: (u) => u.notifyNewMessage,
  quoteAccepted: (u) => u.notifyQuoteAccepted,
  payment: (u) => u.notifyPayment,
  newLead: (u) => u.notifyNewLead,
  jobAssigned: (u) => u.notifyJobAssigned,
  tomorrowDigest: (u) => u.notifyTomorrowDigest,
  invoiceChased: (u) => u.notifyInvoiceChased,
  staleLeads: (u) => u.notifyStaleLeads,
};

// Business/money signal → owner/admin devices only. jobAssigned and
// tomorrowDigest are personal and go to whoever they're addressed to.
const ADMIN_ONLY = new Set<PushCategory>([
  'missedCall',
  'newMessage',
  'quoteAccepted',
  'payment',
  'newLead',
  'invoiceChased',
  'staleLeads',
]);

// Missed calls, messages, and fresh leads want the phone to buzz now; the
// rest can arrive on the OS's normal schedule
const URGENCY: Record<PushCategory, 'high' | 'normal'> = {
  missedCall: 'high',
  newMessage: 'high',
  quoteAccepted: 'normal',
  payment: 'normal',
  newLead: 'high',
  jobAssigned: 'normal',
  tomorrowDigest: 'normal',
  invoiceChased: 'normal',
  staleLeads: 'normal',
};

/** Send to a set of user ids' devices, pruning subscriptions the push
 *  service reports dead (404/410). */
async function sendToUsers(
  db: Db,
  tenantId: string,
  userIds: string[],
  category: PushCategory,
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(tenantWhere(pushSubscriptions, tenantId, inArray(pushSubscriptions.userId, userIds)));
  if (subs.length === 0) return;

  const results = await Promise.allSettled(
    subs.map((s) =>
      sendWebPush(env, { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, URGENCY[category]),
    ),
  );
  const dead = subs.filter((_, i) => {
    const r = results[i];
    return r.status === 'fulfilled' && r.value === 'gone';
  });
  if (dead.length > 0) {
    await db.delete(pushSubscriptions).where(
      tenantWhere(
        pushSubscriptions,
        tenantId,
        inArray(
          pushSubscriptions.id,
          dead.map((d) => d.id),
        ),
      ),
    );
  }
}

export async function notifyTenant(
  db: Db,
  tenantId: string,
  category: PushCategory,
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured(env)) return;
  try {
    const recipients = (
      await db.select().from(users).where(tenantWhere(users, tenantId, eq(users.isActive, true)))
    ).filter((u) => (!ADMIN_ONLY.has(category) || canSeeFinancials(u.role)) && PREF_COLUMN[category](u));
    await sendToUsers(
      db,
      tenantId,
      recipients.map((u) => u.id),
      category,
      payload,
    );
  } catch {
    // never let a notification failure surface into the calling flow
  }
}

export async function notifyUser(
  db: Db,
  tenantId: string,
  userId: string,
  category: PushCategory,
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured(env)) return;
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(tenantWhere(users, tenantId, eq(users.id, userId), eq(users.isActive, true)))
      .limit(1);
    if (!user || !PREF_COLUMN[category](user)) return;
    await sendToUsers(db, tenantId, [user.id], category, payload);
  } catch {
    // never let a notification failure surface into the calling flow
  }
}
