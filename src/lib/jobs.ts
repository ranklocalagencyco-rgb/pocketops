import { eq } from 'drizzle-orm';
import { tenantWhere, type Db } from '../db';
import { jobLineItems, jobs, tenants, type JobStatus } from '../db/schema';

/** Legal pipeline transitions (Module 4). */
export const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  lead: ['quoted', 'cancelled'],
  quoted: ['approved', 'cancelled'],
  approved: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['invoiced'],
  invoiced: ['paid', 'cancelled'],
  paid: [],
  cancelled: ['lead'],
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  lead: 'Lead',
  quoted: 'Quoted',
  approved: 'Approved',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Recompute cached money totals from line items after any mutation.
 * Applies the tenant's default tax rate (Settings → Regional & Tax).
 */
export async function recomputeTotals(db: Db, tenantId: string, jobId: string): Promise<void> {
  const items = await db
    .select()
    .from(jobLineItems)
    .where(tenantWhere(jobLineItems, tenantId, eq(jobLineItems.jobId, jobId)));
  const subtotalCents = items.reduce(
    (sum, li) => sum + Math.round(li.quantity * li.unitPriceCents),
    0,
  );
  const [tenant] = await db
    .select({ taxRateBps: tenants.taxRateBps })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const [jobRow] = await db
    .select({ cisReverseCharge: jobs.cisReverseCharge })
    .from(jobs)
    .where(tenantWhere(jobs, tenantId, eq(jobs.id, jobId)))
    .limit(1);
  // CIS domestic reverse charge: VAT is accounted for by the contractor, not charged
  const taxCents = jobRow?.cisReverseCharge
    ? 0
    : Math.round((subtotalCents * (tenant?.taxRateBps ?? 0)) / 10_000);
  await db
    .update(jobs)
    .set({ subtotalCents, taxCents, totalCents: subtotalCents + taxCents, updatedAt: new Date() })
    .where(tenantWhere(jobs, tenantId, eq(jobs.id, jobId)));
}

/** CIS deduction (standard 20%) applies to LABOUR only, never materials. */
export function cisDeductionCents(
  items: { kind: string; quantity: number; unitPriceCents: number }[],
): number {
  const labour = items
    .filter((li) => li.kind === 'labor')
    .reduce((s, li) => s + Math.round(li.quantity * li.unitPriceCents), 0);
  return Math.round(labour * 0.2);
}

/** Format a timestamp in the tenant's local timezone (localised paid_at). */
export function fmtDateTz(date: Date, timeZone = 'Europe/London'): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function fmtMoney(cents: number, currency = 'gbp'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** Parse a "125.50" style form value into integer cents. Null on garbage. */
export function parseMoney(input: FormDataEntryValue | null): number | null {
  if (typeof input !== 'string' || input.trim() === '') return null;
  const value = Number(input.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
