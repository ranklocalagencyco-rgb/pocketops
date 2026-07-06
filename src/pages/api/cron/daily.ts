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
import { eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { createDb, tenantValues, tenantWhere, type Db } from '../../../db';
import { customers, emailAccounts, jobs, tenants, users } from '../../../db/schema';
import { syncEmailAccount } from '../../../lib/email';
import { newClientToken, newId } from '../../../lib/ids';
import { fmtMoney } from '../../../lib/jobs';
import { sendAndLogSms } from '../../../lib/messages';
import { notifyTenant, notifyUser } from '../../../lib/notify';
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
      const balance = job.totalCents - job.depositPaidCents;
      if (canText && tenant.twilioNumber && customer?.phone) {
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
      // Keep the automation visible — the owner sees the chaser working
      await notifyTenant(db, tenant.id, 'invoiceChased', {
        title: 'Invoice chased',
        body: `${fmtMoney(balance, tenant.currency)} outstanding for "${job.title}" — reminder ${job.chaseCount + 1} of ${MAX_CHASES} sent`,
        url: `/dashboard/jobs/${job.id}`,
        tag: `chase-${job.id}`,
      });
    }

    // --- 1b. Monday morning: leads going cold (weekly, not real-time) ---
    const weekday = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      timeZone: tenant.timezone || 'Europe/London',
    }).format(new Date(now));
    if (weekday === 'Mon') {
      const staleCutoff = new Date(now - 5 * DAY);
      const stale = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          tenantWhere(
            jobs,
            tenant.id,
            inArray(jobs.status, ['lead', 'quoted']),
            lt(jobs.updatedAt, staleCutoff),
          ),
        );
      if (stale.length > 0) {
        await notifyTenant(db, tenant.id, 'staleLeads', {
          title: 'Leads going cold',
          body: `${stale.length} lead${stale.length === 1 ? '' : 's'} or quote${stale.length === 1 ? '' : 's'} haven't moved in 5+ days — worth a ring this week`,
          url: '/dashboard/jobs',
          tag: 'stale-leads',
        });
      }
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

/**
 * Evening run (17:00 UTC): one "tomorrow's jobs" push per person.
 * Owners/admins get the whole diary, field roles only their own jobs —
 * the same visibility split as the app itself.
 */
async function runEveningDigest(db: Db) {
  const summary = { digestsSent: 0 };
  const now = Date.now();
  const allTenants = await db.select().from(tenants);
  for (const tenant of allTenants) {
    if (!withinSendingHours(tenant)) continue; // silent outside their window
    const tz = tenant.timezone || 'Europe/London';
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    const tomorrow = dayKey.format(new Date(now + DAY));

    const booked = (
      await db
        .select()
        .from(jobs)
        .where(
          tenantWhere(
            jobs,
            tenant.id,
            inArray(jobs.status, ['scheduled', 'in_progress']),
            isNotNull(jobs.scheduledAt),
          ),
        )
    )
      .filter((j) => j.scheduledAt && dayKey.format(j.scheduledAt) === tomorrow)
      .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime());
    if (booked.length === 0) continue;

    const team = await db
      .select()
      .from(users)
      .where(tenantWhere(users, tenant.id, eq(users.isActive, true)));
    for (const person of team) {
      const isFieldRole = person.role === 'technician' || person.role === 'apprentice';
      const mine = isFieldRole ? booked.filter((j) => j.assignedUserId === person.id) : booked;
      if (mine.length === 0) continue;
      const first = mine[0];
      const firstTime = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: tz }).format(
        first.scheduledAt!,
      );
      await notifyUser(db, tenant.id, person.id, 'tomorrowDigest', {
        title: `Tomorrow: ${mine.length} job${mine.length === 1 ? '' : 's'}`,
        body: `First at ${firstTime} — "${first.title}"`,
        url: '/dashboard/schedule',
        tag: 'tomorrow-digest',
      });
      summary.digestsSent++;
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

  const db = createDb(env.DB);
  const task = new URL(request.url).searchParams.get('task');
  const summary = task === 'evening' ? await runEveningDigest(db) : await runAutomations(db);
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
};
