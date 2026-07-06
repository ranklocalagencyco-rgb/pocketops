/**
 * CSV exports: /api/app/export/{customers|jobs|invoices|expenses|time-entries}
 * Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (to is inclusive; converted to an
 * exclusive next-day bound). Owner/admin only — these carry financials.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb } from '../../../../db';
import { tenants } from '../../../../db/schema';
import { csvResponse } from '../../../../lib/csv';
import {
  exportCustomers,
  exportExpenses,
  exportInvoices,
  exportJobs,
  exportTimeEntries,
  type ExportRange,
} from '../../../../lib/export';
import { canSeeFinancials } from '../../../../lib/masking';

function parseRange(url: URL): ExportRange {
  const parse = (v: string | null): Date | undefined => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  let from = parse(url.searchParams.get('from'));
  let to = parse(url.searchParams.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  if (to) to = new Date(to.getTime() + 86_400_000); // inclusive day → exclusive bound
  return { from, to };
}

export const GET: APIRoute = async ({ params, url, locals }) => {
  if (!canSeeFinancials(locals.userRole!)) return new Response('Forbidden', { status: 403 });
  const tenantId = locals.tenantId!;
  const db = createDb(env.DB);
  const [tenant] = await db
    .select({ timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const tz = tenant?.timezone ?? 'Europe/London';
  const range = parseRange(url);

  switch (params.kind) {
    case 'customers':
      return csvResponse('pocketops-customers', await exportCustomers(db, tenantId, tz));
    case 'jobs':
      return csvResponse('pocketops-jobs', await exportJobs(db, tenantId, tz, range));
    case 'invoices':
      return csvResponse('pocketops-invoices', await exportInvoices(db, tenantId, tz, range));
    case 'expenses':
      return csvResponse('pocketops-expenses', await exportExpenses(db, tenantId, tz, range));
    case 'time-entries':
      return csvResponse('pocketops-time-entries', await exportTimeEntries(db, tenantId, tz, range));
    default:
      return new Response('Not found', { status: 404 });
  }
};
