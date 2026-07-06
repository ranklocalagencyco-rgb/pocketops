/**
 * CSV importers — customers and historic jobs from competitor exports
 * (Jobber / Tradify / ServiceM8 / generic spreadsheets).
 *
 * Design: direct import with skip-and-report. Invalid rows never abort the
 * batch; each skip carries its 1-based CSV line number and a reason.
 */
import { tenantValues, tenantWhere, type Db } from '../db';
import { customers, jobs, type JobStatus } from '../db/schema';
import { newClientToken, newId } from './ids';
import { parseMoney } from './jobs';

export const MAX_IMPORT_ROWS = 2000;
/** Matches MAX_CHASES in /api/cron/daily — imported invoices are never chased. */
const CHASE_EXEMPT = 3;
const INSERT_CHUNK = 20; // D1 bound-variable limits

export interface ImportSummary {
  inserted: number;
  customersCreated: number;
  skipped: { row: number; reason: string }[];
}

/** lowercase, strip BOM, unify _ - and runs of spaces so header variants match. */
export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolve a header row to canonical-field → column-index. First alias wins. */
export function mapHeaders(
  header: string[],
  aliases: Record<string, string[]>,
): Map<string, number> {
  const normalized = header.map(normalizeHeader);
  const map = new Map<string, number>();
  for (const [field, names] of Object.entries(aliases)) {
    for (const name of names) {
      const idx = normalized.indexOf(name);
      if (idx !== -1) {
        map.set(field, idx);
        break;
      }
    }
  }
  return map;
}

/** parseMoney (lib/jobs) strips $ , and spaces but not £/€ — competitor
 *  exports are full of "£1,234.50". */
export function parseMoneyFlexible(input: string | undefined): number | null {
  if (!input) return null;
  return parseMoney(input.replace(/[£€]/g, ''));
}

/** ISO first, then UK DD/MM/YYYY (or DD-MM-YYYY), then Date.parse fallback. */
export function parseImportDate(input: string | undefined): Date | null {
  if (!input || !input.trim()) return null;
  const s = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const uk = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (uk) {
    const day = +uk[1];
    const month = +uk[2];
    if (month > 12 || day > 31) return null;
    const d = new Date(Date.UTC(+uk[3], month - 1, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** Last 10 digits so "07700 900123" matches "+447700900123". */
function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

function emailKey(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && e.includes('@') ? e : null;
}

const cell = (row: string[], idx: number | undefined): string =>
  idx === undefined ? '' : (row[idx] ?? '').trim();

const orNull = (s: string): string | null => (s === '' ? null : s);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

const CUSTOMER_ALIASES: Record<string, string[]> = {
  name: ['name', 'customer name', 'client name', 'full name', 'contact name', 'company name', 'company'],
  firstName: ['first name', 'first', 'given name'],
  lastName: ['last name', 'last', 'surname'],
  email: ['email', 'email address', 'billing email', 'main email'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'main phone', 'billing phone', 'phone 1', 'telephone'],
  addressLine1: ['address', 'address line 1', 'street', 'street 1', 'billing address', 'billing street', 'property address'],
  addressLine2: ['address line 2', 'street 2'],
  city: ['city', 'town', 'billing city', 'suburb'],
  region: ['region', 'county', 'state', 'province', 'billing state'],
  postalCode: ['postcode', 'postal code', 'post code', 'zip', 'zip code', 'billing zip'],
  notes: ['notes', 'note', 'comments', 'description'],
};

interface DedupeIndex {
  emails: Set<string>;
  phones: Set<string>;
  names: Map<string, string>; // lower-cased name → customer id (jobs matching)
  byEmail: Map<string, string>;
  byPhone: Map<string, string>;
}

async function loadDedupeIndex(db: Db, tenantId: string): Promise<DedupeIndex> {
  const existing = await db
    .select({ id: customers.id, name: customers.name, email: customers.email, phone: customers.phone })
    .from(customers)
    .where(tenantWhere(customers, tenantId));
  const index: DedupeIndex = {
    emails: new Set(),
    phones: new Set(),
    names: new Map(),
    byEmail: new Map(),
    byPhone: new Map(),
  };
  for (const c of existing) {
    const e = emailKey(c.email);
    const p = phoneKey(c.phone);
    if (e) {
      index.emails.add(e);
      index.byEmail.set(e, c.id);
    }
    if (p) {
      index.phones.add(p);
      index.byPhone.set(p, c.id);
    }
    index.names.set(c.name.trim().toLowerCase(), c.id);
  }
  return index;
}

export async function importCustomers(
  db: Db,
  tenantId: string,
  rows: string[][],
  opts: { dedupe: boolean },
): Promise<ImportSummary> {
  const summary: ImportSummary = { inserted: 0, customersCreated: 0, skipped: [] };
  if (rows.length < 2) throw new ImportError('No data rows found — is the header the only line?');
  const cols = mapHeaders(rows[0], CUSTOMER_ALIASES);
  if (!cols.has('name') && !(cols.has('firstName') || cols.has('lastName'))) {
    throw new ImportError('Couldn’t find a Name column — check the file’s headers.');
  }

  const index = await loadDedupeIndex(db, tenantId);
  const pending: (typeof customers.$inferInsert)[] = [];

  rows.slice(1).forEach((row, i) => {
    const line = i + 2; // 1-based, after header
    const name =
      cell(row, cols.get('name')) ||
      [cell(row, cols.get('firstName')), cell(row, cols.get('lastName'))].filter(Boolean).join(' ');
    if (!name) {
      summary.skipped.push({ row: line, reason: 'no name' });
      return;
    }
    const email = orNull(cell(row, cols.get('email')));
    const phone = orNull(cell(row, cols.get('phone')));
    const e = emailKey(email);
    const p = phoneKey(phone);
    if (opts.dedupe && ((e && index.emails.has(e)) || (p && index.phones.has(p)))) {
      summary.skipped.push({ row: line, reason: `duplicate of existing customer (${e && index.emails.has(e) ? 'email' : 'phone'})` });
      return;
    }
    // Absorb into the index so in-file duplicates also dedupe
    if (e) index.emails.add(e);
    if (p) index.phones.add(p);
    pending.push(
      tenantValues(tenantId, {
        id: newId(),
        name,
        email,
        phone,
        addressLine1: orNull(cell(row, cols.get('addressLine1'))),
        addressLine2: orNull(cell(row, cols.get('addressLine2'))),
        city: orNull(cell(row, cols.get('city'))),
        region: orNull(cell(row, cols.get('region'))),
        postalCode: orNull(cell(row, cols.get('postalCode'))),
        notes: orNull(cell(row, cols.get('notes'))),
      }),
    );
  });

  for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
    await db.insert(customers).values(pending.slice(i, i + INSERT_CHUNK));
  }
  summary.inserted = pending.length;
  return summary;
}

// ---------------------------------------------------------------------------
// Historic jobs
// ---------------------------------------------------------------------------

const JOB_ALIASES: Record<string, string[]> = {
  customerName: ['customer', 'client', 'customer name', 'client name', 'name', 'contact name'],
  customerEmail: ['customer email', 'client email', 'email', 'email address'],
  customerPhone: ['customer phone', 'client phone', 'phone', 'mobile', 'phone number'],
  title: ['title', 'job title', 'job name', 'job', 'subject', 'name of job'],
  description: ['description', 'job description', 'details', 'instructions'],
  status: ['status', 'job status', 'stage', 'state'],
  total: ['total', 'amount', 'total amount', 'invoice total', 'gross', 'total inc vat', 'price', 'value'],
  vat: ['vat', 'vat amount', 'tax', 'tax amount'],
  date: ['date', 'created', 'created date', 'job date', 'issue date', 'invoice date', 'start date'],
  paidDate: ['paid', 'paid date', 'date paid', 'payment date'],
};

const STATUS_MAP: Record<string, JobStatus> = {
  lead: 'lead', new: 'lead', enquiry: 'lead', inquiry: 'lead', draft: 'lead', 'requires quote': 'lead',
  quote: 'quoted', quoted: 'quoted', 'quote sent': 'quoted', estimate: 'quoted', 'estimate sent': 'quoted',
  pending: 'quoted', 'awaiting acceptance': 'quoted',
  approved: 'approved', accepted: 'approved', 'quote accepted': 'approved', won: 'approved',
  scheduled: 'scheduled', booked: 'scheduled',
  'in progress': 'in_progress', active: 'in_progress', started: 'in_progress', wip: 'in_progress',
  'work in progress': 'in_progress',
  complete: 'completed', completed: 'completed', done: 'completed', finished: 'completed',
  'awaiting invoice': 'completed',
  invoiced: 'invoiced', 'invoice sent': 'invoiced', 'awaiting payment': 'invoiced', unpaid: 'invoiced',
  overdue: 'invoiced', open: 'invoiced', sent: 'invoiced',
  paid: 'paid', 'payment received': 'paid', 'paid in full': 'paid', closed: 'paid', archived: 'paid',
  cancelled: 'cancelled', canceled: 'cancelled', lost: 'cancelled', rejected: 'cancelled',
  void: 'cancelled', declined: 'cancelled',
};

export async function importJobs(db: Db, tenantId: string, rows: string[][]): Promise<ImportSummary> {
  const summary: ImportSummary = { inserted: 0, customersCreated: 0, skipped: [] };
  if (rows.length < 2) throw new ImportError('No data rows found — is the header the only line?');
  const cols = mapHeaders(rows[0], JOB_ALIASES);
  if (!cols.has('customerName') && !cols.has('customerEmail') && !cols.has('customerPhone')) {
    throw new ImportError('Couldn’t find a Customer column — check the file’s headers.');
  }
  if (!cols.has('total')) {
    throw new ImportError('Couldn’t find a Total/Amount column — check the file’s headers.');
  }

  const index = await loadDedupeIndex(db, tenantId);
  const newCustomers: (typeof customers.$inferInsert)[] = [];
  const newJobs: (typeof jobs.$inferInsert)[] = [];

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    // Validate the money before any side effects so a skipped row never
    // leaves a stray created customer behind.
    const totalCents = parseMoneyFlexible(cell(row, cols.get('total')));
    if (totalCents === null) {
      summary.skipped.push({ row: line, reason: 'missing or invalid total' });
      return;
    }

    const custName = cell(row, cols.get('customerName'));
    const custEmail = orNull(cell(row, cols.get('customerEmail')));
    const custPhone = orNull(cell(row, cols.get('customerPhone')));
    const e = emailKey(custEmail);
    const p = phoneKey(custPhone);

    // Match: email → phone → exact name; create when unmatched
    let customerId = (e && index.byEmail.get(e)) || (p && index.byPhone.get(p)) || null;
    if (!customerId && custName) customerId = index.names.get(custName.toLowerCase()) ?? null;
    if (!customerId) {
      if (!custName) {
        summary.skipped.push({ row: line, reason: 'no customer name, email, or phone' });
        return;
      }
      customerId = newId();
      newCustomers.push(
        tenantValues(tenantId, { id: customerId, name: custName, email: custEmail, phone: custPhone }),
      );
      index.names.set(custName.toLowerCase(), customerId);
      if (e) index.byEmail.set(e, customerId);
      if (p) index.byPhone.set(p, customerId);
      summary.customersCreated++;
    }

    const vatCents = parseMoneyFlexible(cell(row, cols.get('vat')));
    let taxCents = 0;
    let subtotalCents = totalCents;
    if (vatCents !== null) {
      if (vatCents > totalCents) {
        summary.skipped.push({ row: line, reason: 'VAT greater than total' });
        return;
      }
      taxCents = vatCents;
      subtotalCents = totalCents - vatCents;
    }

    const paidDate = parseImportDate(cell(row, cols.get('paidDate')));
    const rawStatus = normalizeHeader(cell(row, cols.get('status')));
    let status: JobStatus = STATUS_MAP[rawStatus] ?? 'completed';
    if (!STATUS_MAP[rawStatus] && paidDate) status = 'paid';

    const date = parseImportDate(cell(row, cols.get('date'))) ?? new Date();
    const atLeast = (s: JobStatus[]) => s.includes(status);

    newJobs.push(
      tenantValues(tenantId, {
        id: newId(),
        customerId,
        title: cell(row, cols.get('title')) || 'Imported job',
        description: orNull(cell(row, cols.get('description'))),
        status,
        clientToken: newClientToken(),
        subtotalCents,
        taxCents,
        totalCents,
        completedAt: atLeast(['completed', 'invoiced', 'paid']) ? date : null,
        invoicedAt: atLeast(['invoiced', 'paid']) ? date : null,
        paidAt: status === 'paid' ? (paidDate ?? date) : null,
        // Never auto-chase imported history (cron filters chaseCount < 3).
        chaseCount: CHASE_EXEMPT,
        createdAt: date,
        updatedAt: new Date(),
        // No line items are created: the imported totals are authoritative.
        // recomputeTotals must not run here — with zero line items it would
        // wipe them. A later manual line-item edit recomputing is acceptable.
      }),
    );
  });

  for (let i = 0; i < newCustomers.length; i += INSERT_CHUNK) {
    await db.insert(customers).values(newCustomers.slice(i, i + INSERT_CHUNK));
  }
  for (let i = 0; i < newJobs.length; i += INSERT_CHUNK) {
    await db.insert(jobs).values(newJobs.slice(i, i + INSERT_CHUNK));
  }
  summary.inserted = newJobs.length;
  return summary;
}

/** User-facing import failure (bad headers, empty file) — message is shown as-is. */
export class ImportError extends Error {}
