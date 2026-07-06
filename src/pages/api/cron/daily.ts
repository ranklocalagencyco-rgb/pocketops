/**
 * Daily automations — hit once a day with the CRON_SECRET (Cloudflare Worker
 * cron, GitHub Action, or uptime pinger), or run manually from Settings →
 * Automations (owner/admin session).
 *
 *  1. Overdue-invoice chasing: unpaid 7+ days → SMS with the payment link,
 *     re-nudged weekly, max 3 chases.
 *  2. Recurring work: paid jobs with a recurrence spawn a new lead ~2 weeks
 *     before the service is due, and the customer gets a heads-up text.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq, isNotNull, lt } from 'drizzle-orm';
import { createDb, tenantValues, tenantWhere, type Db } from '../../../db';
import { customers, emailAccounts, jobs, tenants } from '../../../db/schema';
import { syncEmailAccount } from '../../../lib/email';
import { newClientToken, newId } from '../../../lib/ids';
import { fmtMoney } from '../../../lib/jobs';
import { sendAndLogSms } from '../../../lib/messages';
import { withinSendingHours } from '../../../lib/quiet-hours';
import { twilioConfigured } from '../../../lib/twilio';

const DAY = 24 * 60 * 60 * 1000;
const CHASE_AFTER_DAYS = 7;
const MAX_CHASES = 3;
const RECURRENCE_LEAD_DAYS = 14;

async function runAutomations(db: Db) {
  const summary = { chased: 0, recurringSpawned: 0, emailsSynced: 0 };
  const now = Date.now();
  const appUrl = env.APP_URL || 'https://pocketops.io';
  const canText = twilioConfigured(env);

  const allTenants = await db.select().from(tenants);
  for (const tenant of allTenants) {
    // Quiet hours: outside the tenant's window texts wait for tomorrow's run;
    // the chase cadence and recurrence lead time tolerate a day's slip.
    const canTextNow = canText && withinSendingHours(tenant);

    // --- 1. Chase overdue invoices ---
    const overdue = await db
      .select()
      .from(jobs)
      .where(
        tenantWhere(
          jobs,
          tenant.id,
          eq(jobs.status, 'invoiced'),
          isNotNull(jobs.invoicedAt),
          lt(jobs.invoicedAt, new Date(now - CHASE_AFTER_DAYS * DAY)),
          lt(jobs.chaseCount, MAX_CHASES),
        ),
      );
    for (const job of overdue) {
      if (job.lastChasedAt && job.lastChasedAt.getTime() > now - CHASE_AFTER_DAYS * DAY) continue;
      if (canText && !canTextNow) continue; // retry tomorrow inside hours
      const [customer] = await db
        .select()
        .from(customers)
        .where(tenantWhere(customers, tenant.id, eq(customers.id, job.customerId)))
        .limit(1);
      if (canText && tenant.twilioNumber && customer?.phone) {
        const balance = job.totalCents - job.depositPaidCents;
        const result = await sendAndLogSms(db, env, tenant.id, {
          to: customer.phone,
          from: tenant.twilioNumber,
          customerId: customer.id,
          body: `Hi ${customer.name.split(/\s+/)[0]}, a friendly reminder from ${tenant.name}: ${fmtMoney(balance, tenant.currency)} is outstanding for "${job.title}". Pay securely in one tap: ${appUrl}/approve/${job.clientToken}`,
        });
        if (!result.ok) continue;
      }
      await db
        .update(jobs)
        .set({ lastChasedAt: new Date(), chaseCount: job.chaseCount + 1 })
        .where(tenantWhere(jobs, tenant.id, eq(jobs.id, job.id)));
      summary.chased++;
    }

    // --- 2. Spawn recurring service jobs ---
    const recurring = await db
      .select()
      .from(jobs)
      .where(
        tenantWhere(
          jobs,
          tenant.id,
          eq(jobs.status, 'paid'),
          isNotNull(jobs.recurrenceMonths),
          eq(jobs.recurrenceSpawned, false),
        ),
      );
    for (const job of recurring) {
      if (!job.paidAt || !job.recurrenceMonths) continue;
      const due = new Date(job.paidAt);
      due.setMonth(due.getMonth() + job.recurrenceMonths);
      if (due.getTime() - RECURRENCE_LEAD_DAYS * DAY > now) continue;

      await db.insert(jobs).values(
        tenantValues(tenant.id, {
          id: newId(),
          customerId: job.customerId,
          assignedUserId: job.assignedUserId,
          title: job.title.replace(/ — service due$/, '') + ' — service due',
          description: `Recurring service (every ${job.recurrenceMonths} months).`,
          clientToken: newClientToken(),
          recurrenceMonths: job.recurrenceMonths,
        }),
      );
      await db
        .update(jobs)
        .set({ recurrenceSpawned: true })
        .where(tenantWhere(jobs, tenant.id, eq(jobs.id, job.id)));

      const [customer] = await db
        .select()
        .from(customers)
        .where(tenantWhere(customers, tenant.id, eq(customers.id, job.customerId)))
        .limit(1);
      if (canTextNow && tenant.twilioNumber && customer?.phone) {
        await sendAndLogSms(db, env, tenant.id, {
          to: customer.phone,
          from: tenant.twilioNumber,
          customerId: customer.id,
          body: `Hi ${customer.name.split(/\s+/)[0]}, it's ${tenant.name} — your "${job.title.replace(/ — service due$/, '')}" service is due soon. Reply here and we'll get you booked in.`,
        });
      }
      summary.recurringSpawned++;
    }

    // --- 3. Pull new customer emails into the inbox ---
    const mailboxes = await db
      .select()
      .from(emailAccounts)
      .where(tenantWhere(emailAccounts, tenant.id, eq(emailAccounts.status, 'active')));
    for (const account of mailboxes) {
      try {
        summary.emailsSynced += await syncEmailAccount(db, env, account);
      } catch {
        // Sync failures never break the run; the account shows as errored
        await db
          .update(emailAccounts)
          .set({ status: 'error' })
          .where(tenantWhere(emailAccounts, tenant.id, eq(emailAccounts.id, account.id)));
      }
    }
  }
  return summary;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const authed =
    (env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`) ||
    locals.userRole === 'owner' ||
    locals.userRole === 'admin';
  if (!authed) return new Response('Unauthorized', { status: 401 });

  const summary = await runAutomations(createDb(env.DB));
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
};
