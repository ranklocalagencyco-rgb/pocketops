/**
 * CSV export row builders — shared by /api/app/export/[kind] and the
 * backup ZIP. Accountant-friendly formats: money as plain decimal pounds
 * (no symbol, sums in Excel), dates as YYYY-MM-DD (+ HH:mm where time
 * matters) rendered in the tenant's timezone.
 */
import { and, desc, gte, inArray, lt, or } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { tenantWhere, type Db } from '../db';
import {
  customers,
  expenses,
  jobLineItems,
  jobs,
  priceBookItems,
  timeEntries,
  users,
} from '../db/schema';
import type { CsvRows } from './csv';
import { cisDeductionCents, STATUS_LABELS } from './jobs';

export interface ExportRange {
  from?: Date;
  to?: Date; // exclusive
}

const pounds = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);

function tzParts(d: Date, tz: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

export function isoDate(d: Date | null | undefined, tz: string): string {
  if (!d) return '';
  const p = tzParts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function isoDateTime(d: Date | null | undefined, tz: string): string {
  if (!d) return '';
  const p = tzParts(d, tz);
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

const yesNo = (b: boolean): string => (b ? 'Yes' : 'No');

function rangeFilter(column: any, r?: ExportRange) {
  if (!r) return undefined;
  const conds = [];
  if (r.from) conds.push(gte(column, r.from));
  if (r.to) conds.push(lt(column, r.to));
  return conds.length ? and(...conds) : undefined;
}

export async function exportCustomers(db: Db, tenantId: string, tz: string): Promise<CsvRows> {
  const rows = await db
    .select()
    .from(customers)
    .where(tenantWhere(customers, tenantId))
    .orderBy(customers.name);
  return [
    ['Name', 'Email', 'Phone', 'Address line 1', 'Address line 2', 'City', 'County', 'Postcode', 'Notes', 'Created'],
    ...rows.map((c) => [
      c.name, c.email, c.phone, c.addressLine1, c.addressLine2, c.city, c.region, c.postalCode,
      c.notes, isoDate(c.createdAt, tz),
    ]),
  ];
}

export async function exportJobs(db: Db, tenantId: string, tz: string, r?: ExportRange): Promise<CsvRows> {
  const rows = await db
    .select({ job: jobs, customer: customers })
    .from(jobs)
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(tenantWhere(jobs, tenantId, rangeFilter(jobs.createdAt, r)))
    .orderBy(desc(jobs.createdAt));
  return [
    ['Job ID', 'Title', 'Status', 'Customer', 'Customer email', 'Customer phone', 'Scheduled',
     'Net', 'VAT', 'Total', 'Invoiced', 'Completed', 'Paid', 'CIS reverse charge', 'Created'],
    ...rows.map(({ job: j, customer: c }) => [
      j.id, j.title, STATUS_LABELS[j.status], c?.name, c?.email, c?.phone,
      isoDateTime(j.scheduledAt, tz), pounds(j.subtotalCents), pounds(j.taxCents), pounds(j.totalCents),
      isoDate(j.invoicedAt, tz), isoDate(j.completedAt, tz), isoDate(j.paidAt, tz),
      yesNo(j.cisReverseCharge), isoDate(j.createdAt, tz),
    ]),
  ];
}

export async function exportInvoices(db: Db, tenantId: string, tz: string, r?: ExportRange): Promise<CsvRows> {
  const rows = await db
    .select({ job: jobs, customer: customers })
    .from(jobs)
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      tenantWhere(
        jobs,
        tenantId,
        or(eq(jobs.status, 'invoiced'), eq(jobs.status, 'paid')),
        rangeFilter(jobs.invoicedAt, r),
      ),
    )
    .orderBy(desc(jobs.invoicedAt));

  // CIS deduction needs labour line items; bulk-load for the exported jobs.
  // Imported historic jobs have no line items → 0.00 by construction.
  const jobIds = rows.map((row) => row.job.id);
  const itemsByJob = new Map<string, { kind: string; quantity: number; unitPriceCents: number }[]>();
  if (jobIds.length) {
    const items = await db
      .select({
        jobId: jobLineItems.jobId,
        kind: jobLineItems.kind,
        quantity: jobLineItems.quantity,
        unitPriceCents: jobLineItems.unitPriceCents,
      })
      .from(jobLineItems)
      .where(tenantWhere(jobLineItems, tenantId, inArray(jobLineItems.jobId, jobIds)));
    for (const it of items) {
      const list = itemsByJob.get(it.jobId) ?? [];
      list.push(it);
      itemsByJob.set(it.jobId, list);
    }
  }

  return [
    ['Job ID', 'Title', 'Customer', 'Invoiced date', 'Paid date', 'Net', 'VAT rate %', 'VAT', 'Gross',
     'CIS reverse charge', 'CIS deduction', 'Payment status'],
    ...rows.map(({ job: j, customer: c }) => [
      j.id, j.title, c?.name, isoDate(j.invoicedAt, tz), isoDate(j.paidAt, tz),
      pounds(j.subtotalCents),
      j.subtotalCents > 0 ? ((j.taxCents / j.subtotalCents) * 100).toFixed(1) : '',
      pounds(j.taxCents), pounds(j.totalCents), yesNo(j.cisReverseCharge),
      pounds(j.cisReverseCharge ? cisDeductionCents(itemsByJob.get(j.id) ?? []) : 0),
      j.status === 'paid' ? 'Paid' : 'Outstanding',
    ]),
  ];
}

export async function exportExpenses(db: Db, tenantId: string, tz: string, r?: ExportRange): Promise<CsvRows> {
  const rows = await db
    .select({ expense: expenses, job: jobs, user: users })
    .from(expenses)
    .leftJoin(jobs, eq(expenses.jobId, jobs.id))
    .leftJoin(users, eq(expenses.userId, users.id))
    .where(tenantWhere(expenses, tenantId, rangeFilter(expenses.createdAt, r)))
    .orderBy(desc(expenses.createdAt));
  return [
    ['Date', 'Description', 'Amount', 'Job ID', 'Job title', 'Logged by'],
    ...rows.map(({ expense: e, job: j, user: u }) => [
      isoDate(e.createdAt, tz), e.description, pounds(e.amountCents), e.jobId, j?.title, u?.name,
    ]),
  ];
}

export async function exportTimeEntries(db: Db, tenantId: string, tz: string, r?: ExportRange): Promise<CsvRows> {
  const rows = await db
    .select({ entry: timeEntries, job: jobs, user: users })
    .from(timeEntries)
    .leftJoin(jobs, eq(timeEntries.jobId, jobs.id))
    .leftJoin(users, eq(timeEntries.userId, users.id))
    .where(tenantWhere(timeEntries, tenantId, rangeFilter(timeEntries.startedAt, r)))
    .orderBy(desc(timeEntries.startedAt));
  return [
    ['Started', 'Ended', 'Duration (hrs)', 'User', 'Job ID', 'Job title', 'Lat', 'Lng'],
    ...rows.map(({ entry: t, job: j, user: u }) => [
      isoDateTime(t.startedAt, tz),
      isoDateTime(t.endedAt, tz),
      t.endedAt ? ((t.endedAt.getTime() - t.startedAt.getTime()) / 3_600_000).toFixed(2) : '',
      u?.name, t.jobId, j?.title, t.lat, t.lng,
    ]),
  ];
}

export async function exportPriceBook(db: Db, tenantId: string): Promise<CsvRows> {
  const rows = await db
    .select()
    .from(priceBookItems)
    .where(tenantWhere(priceBookItems, tenantId))
    .orderBy(priceBookItems.description);
  return [
    ['Kind', 'Description', 'Unit price', 'Unit cost', 'Active'],
    ...rows.map((p) => [p.kind, p.description, pounds(p.unitPriceCents), pounds(p.unitCostCents), yesNo(p.isActive)]),
  ];
}
