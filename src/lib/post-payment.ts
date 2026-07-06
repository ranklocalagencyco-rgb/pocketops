/**
 * Everything that fires the moment a job is paid — by Stripe webhook OR a
 * manual cash/check "Mark paid". One code path so the 5-star review loop
 * (Module 8) and ledger sync (Module 9) never depend on HOW money arrived.
 */
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { tenantValues, tenantWhere, type Db } from '../db';
import { customers, reviewRequests, tenants } from '../db/schema';
import { syncPaidJob } from './accounting';
import { newId } from './ids';
import { withinSendingHours } from './quiet-hours';
import { sendSms, twilioConfigured } from './twilio';

export async function handleJobPaid(
  db: Db,
  tenantId: string,
  jobId: string,
  customerId: string,
): Promise<void> {
  await triggerReviewLoop(db, tenantId, jobId, customerId);
  await syncPaidJob(db, env, tenantId, jobId);
}

async function triggerReviewLoop(
  db: Db,
  tenantId: string,
  jobId: string,
  customerId: string,
): Promise<void> {
  try {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant?.reviewLinkUrl) return;
    const [customer] = await db
      .select()
      .from(customers)
      .where(tenantWhere(customers, tenantId, eq(customers.id, customerId)))
      .limit(1);
    if (!customer?.phone) return;

    const requestId = newId();
    await db.insert(reviewRequests).values(
      tenantValues(tenantId, {
        id: requestId,
        jobId,
        customerId,
        channel: 'sms',
        reviewLink: tenant.reviewLinkUrl,
      }),
    );

    // Late-night payments don't earn a 1am text; the request row still exists
    // so the tenant can chase a review manually from the job page.
    if (twilioConfigured(env) && tenant.twilioNumber && withinSendingHours(tenant)) {
      // Custom template from Settings → Reviews; {name} and {link} supported
      const template = tenant.reviewMessage?.trim();
      const firstName = customer.name.split(/\s+/)[0] ?? 'there';
      let body: string;
      if (template) {
        body = template.replaceAll('{name}', firstName);
        body = body.includes('{link}')
          ? body.replaceAll('{link}', tenant.reviewLinkUrl)
          : `${body} ${tenant.reviewLinkUrl}`;
      } else {
        body = `Thanks for choosing ${tenant.name}! If we did a great job, a quick review means the world to us: ${tenant.reviewLinkUrl}`;
      }
      const result = await sendSms(env, {
        to: customer.phone,
        from: tenant.twilioNumber,
        body,
      });
      if (result.ok) {
        await db
          .update(reviewRequests)
          .set({ sentAt: new Date() })
          .where(tenantWhere(reviewRequests, tenantId, eq(reviewRequests.id, requestId)));
      }
    }
  } catch {
    // The review loop must never fail a payment flow
  }
}
