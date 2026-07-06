/**
 * Stripe confirmation webhook (Module 6) → triggers the 5-star review loop
 * (Module 8) and ledger sync (Module 9) via the shared post-payment path.
 *
 * Signature verification uses the RAW request body + constructEventAsync
 * with the SubtleCrypto provider — the only combination that works in
 * Cloudflare V8 isolates.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { createDb, tenantValues, tenantWhere } from '../../../db';
import { jobLineItems, jobs, payments, tenants } from '../../../db/schema';
import { newId } from '../../../lib/ids';
import { cisDeductionCents, fmtMoney } from '../../../lib/jobs';
import { notifyTenant } from '../../../lib/notify';
import { handleJobPaid } from '../../../lib/post-payment';
import { getStripe, webhookCryptoProvider } from '../../../lib/stripe';

export const POST: APIRoute = async ({ request }) => {
  const stripe = getStripe(env);
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Stripe not configured', { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      webhookCryptoProvider,
    );
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const jobId = session.metadata?.jobId;
    const tenantId = session.metadata?.tenantId;
    if (jobId && tenantId && session.payment_status === 'paid') {
      const db = createDb(env.DB);

      // Connect events name the account they fired on — it must be the
      // account of the tenant in the metadata, or one connected account
      // could flip another tenant's jobs to paid with forged metadata.
      if (event.account) {
        const [tenant] = await db
          .select({ stripeAccountId: tenants.stripeAccountId })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        if (!tenant || tenant.stripeAccountId !== event.account) {
          return new Response(JSON.stringify({ received: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      const [job] = await db
        .select()
        .from(jobs)
        .where(tenantWhere(jobs, tenantId, eq(jobs.id, jobId)))
        .limit(1);

      // Deposit paid at quote acceptance → quote becomes approved
      if (job && session.metadata?.type === 'deposit' && job.status === 'quoted') {
        const now = new Date();
        const depositCents = session.amount_total ?? 0;
        await db
          .update(jobs)
          .set({
            status: 'approved',
            quoteAcceptedAt: now,
            quoteAcceptedName: session.metadata?.acceptName ?? null,
            depositPaidCents: depositCents,
            updatedAt: now,
          })
          .where(tenantWhere(jobs, tenantId, eq(jobs.id, jobId)));
        await db.insert(payments).values(
          tenantValues(tenantId, {
            id: newId(),
            jobId,
            amountCents: depositCents,
            currency: session.currency ?? 'gbp',
            method: 'card',
            status: 'succeeded',
            stripePaymentIntentId:
              typeof session.payment_intent === 'string' ? session.payment_intent : null,
            paidAt: now,
          }),
        );
        await notifyTenant(db, tenantId, 'quoteAccepted', {
          title: 'Quote accepted',
          body: `${session.metadata?.acceptName ?? 'Your customer'} accepted "${job.title}" and paid a ${fmtMoney(depositCents, session.currency ?? 'gbp')} deposit`,
          url: `/dashboard/jobs/${jobId}`,
          tag: `accept-${jobId}`,
        });
      }

      // Balance / part payments — job flips to paid only when fully covered
      if (job && session.metadata?.type !== 'deposit' && job.status === 'invoiced') {
        const paidAt = new Date();
        const paymentIntentId =
          typeof session.payment_intent === 'string' ? session.payment_intent : null;

        try {
          await db.insert(payments).values(
            tenantValues(tenantId, {
              id: newId(),
              jobId,
              amountCents: session.amount_total ?? job.totalCents,
              currency: session.currency ?? 'gbp',
              method: 'card',
              status: 'succeeded',
              stripePaymentIntentId: paymentIntentId,
              paidAt,
            }),
          );
        } catch {
          // Unique payment-intent constraint: webhook replay, nothing to do
          return new Response(JSON.stringify({ received: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const allPayments = await db
          .select({ amountCents: payments.amountCents, status: payments.status })
          .from(payments)
          .where(tenantWhere(payments, tenantId, eq(payments.jobId, jobId)));
        const paidSum = allPayments
          .filter((p) => p.status === 'succeeded')
          .reduce((s, p) => s + p.amountCents, 0);
        const items = job.cisReverseCharge
          ? await db
              .select()
              .from(jobLineItems)
              .where(tenantWhere(jobLineItems, tenantId, eq(jobLineItems.jobId, jobId)))
          : [];
        const owed = job.totalCents - (job.cisReverseCharge ? cisDeductionCents(items) : 0);

        if (paidSum >= owed) {
          await db
            .update(jobs)
            .set({
              status: 'paid',
              paidAt,
              stripeCheckoutSessionId: session.id,
              stripePaymentIntentId: paymentIntentId,
              updatedAt: paidAt,
            })
            .where(tenantWhere(jobs, tenantId, eq(jobs.id, jobId)));
          // Modules 8 + 9: review SMS + QBO/Xero push
          await handleJobPaid(db, tenantId, jobId, job.customerId);
        } else {
          await db
            .update(jobs)
            .set({ updatedAt: paidAt })
            .where(tenantWhere(jobs, tenantId, eq(jobs.id, jobId)));
        }
        await notifyTenant(db, tenantId, 'payment', {
          title: 'Payment received',
          body: `${fmtMoney(session.amount_total ?? job.totalCents, session.currency ?? 'gbp')} for "${job.title}"${paidSum >= owed ? ' — paid in full' : ' (part payment)'}`,
          url: `/dashboard/jobs/${jobId}`,
          tag: `pay-${jobId}`,
        });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
