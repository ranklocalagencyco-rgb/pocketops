/**
 * Push notification fan-out. Call from the event that just happened
 * (webhook, portal action, booking form) — it finds every owner/admin
 * device with that category enabled and sends. Failures are swallowed:
 * a push must never break the payment/webhook that triggered it.
 */
import { env } from 'cloudflare:workers';
import { eq, inArray } from 'drizzle-orm';
import { tenantWhere, type Db } from '../db';
import { pushSubscriptions, users } from '../db/schema';
import { canSeeFinancials } from './masking';
import { pushConfigured, sendWebPush, type PushPayload } from './webpush';

export type PushCategory = 'missedCall' | 'newMessage' | 'quoteAccepted' | 'payment' | 'newLead';

const PREF_COLUMN: Record<PushCategory, (u: typeof users.$inferSelect) => boolean> = {
  missedCall: (u) => u.notifyMissedCall,
  newMessage: (u) => u.notifyNewMessage,
  quoteAccepted: (u) => u.notifyQuoteAccepted,
  payment: (u) => u.notifyPayment,
  newLead: (u) => u.notifyNewLead,
};

// Missed calls and new messages want the phone to buzz now; the rest can
// arrive on the OS's normal schedule
const URGENCY: Record<PushCategory, 'high' | 'normal'> = {
  missedCall: 'high',
  newMessage: 'high',
  quoteAccepted: 'normal',
  payment: 'normal',
  newLead: 'high',
};

export async function notifyTenant(
  db: Db,
  tenantId: string,
  category: PushCategory,
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured(env)) return;
  try {
    // All launch categories carry business/money signals → owner/admin only,
    // same server-side gate the app uses for financial masking
    const recipients = (
      await db.select().from(users).where(tenantWhere(users, tenantId, eq(users.isActive, true)))
    ).filter((u) => canSeeFinancials(u.role) && PREF_COLUMN[category](u));
    if (recipients.length === 0) return;

    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(
        tenantWhere(
          pushSubscriptions,
          tenantId,
          inArray(
            pushSubscriptions.userId,
            recipients.map((u) => u.id),
          ),
        ),
      );
    if (subs.length === 0) return;

    const results = await Promise.allSettled(
      subs.map((s) =>
        sendWebPush(env, { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, URGENCY[category]),
      ),
    );

    // Push services answer 404/410 for expired/revoked subscriptions — prune
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
  } catch {
    // never let a notification failure surface into the calling flow
  }
}
