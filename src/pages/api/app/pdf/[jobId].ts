/**
 * Quote / VAT-invoice PDF, generated with pdf-lib (pure JS, isolate-safe).
 * Quote layout for pre-invoice stages; VAT invoice once invoiced/paid.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { asc, eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createDb, tenantWhere } from '../../../../db';
import { customers, jobLineItems, jobs, tenants } from '../../../../db/schema';
import { fmtDateTz, fmtMoney } from '../../../../lib/jobs';

export const GET: APIRoute = async ({ params, locals }) => {
  const tenantId = locals.tenantId!;
  const db = createDb(env.DB);

  const [job] = await db
    .select()
    .from(jobs)
    .where(tenantWhere(jobs, tenantId, eq(jobs.id, params.jobId ?? '')))
    .limit(1);
  if (!job) return new Response('Not found', { status: 404 });
  const isFieldRole = locals.userRole === 'technician' || locals.userRole === 'apprentice';
  if (isFieldRole && job.assignedUserId !== locals.userId) {
    return new Response('Not found', { status: 404 });
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const [customer] = await db
    .select()
    .from(customers)
    .where(tenantWhere(customers, tenantId, eq(customers.id, job.customerId)))
    .limit(1);
  const items = await db
    .select()
    .from(jobLineItems)
    .where(tenantWhere(jobLineItems, tenantId, eq(jobLineItems.jobId, job.id)))
    .orderBy(asc(jobLineItems.sortOrder), asc(jobLineItems.id));

  const isInvoice = job.status === 'invoiced' || job.status === 'paid';
  const currency = tenant?.currency;
  const money = (c: number) => fmtMoney(c, currency);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Company logo (best-effort — a missing/corrupt image never blocks the PDF)
  let logoImg = null;
  let logoW = 0;
  let logoH = 0;
  if (tenant?.logoR2Key) {
    try {
      const obj = await env.FILES.get(tenant.logoR2Key);
      if (obj) {
        const bytes = new Uint8Array(await obj.arrayBuffer());
        logoImg =
          tenant.logoContentType === 'image/jpeg'
            ? await pdf.embedJpg(bytes)
            : await pdf.embedPng(bytes);
        const scale = Math.min(46 / logoImg.height, 150 / logoImg.width, 1);
        logoW = logoImg.width * scale;
        logoH = logoImg.height * scale;
      }
    } catch {
      logoImg = null;
    }
  }
  const ink = rgb(0.1, 0.09, 0.08);
  const grey = rgb(0.45, 0.42, 0.4);
  const copper = rgb(0.91, 0.45, 0.1);
  let y = 790;

  const text = (s: string, x: number, size = 10, f = font, color = ink) =>
    page.drawText(s, { x, y, size, font: f, color });
  const right = (s: string, size = 10, f = font, color = ink) =>
    page.drawText(s, { x: 545 - f.widthOfTextAtSize(s, size), y, size, font: f, color });

  text(isInvoice ? 'INVOICE' : 'QUOTE', 50, 26, bold, copper);
  if (logoImg) {
    page.drawImage(logoImg, { x: 545 - logoW, y: 802 - logoH, width: logoW, height: logoH });
    y = 802 - logoH - 16;
  }
  right(tenant?.name ?? '', 14, bold);
  y -= 16;
  const cityLine = [tenant?.city, tenant?.region, tenant?.postalCode].filter(Boolean).join(', ');
  for (const line of [tenant?.addressLine1, tenant?.addressLine2, cityLine]) {
    if (line) { right(line, 9, font, grey); y -= 12; }
  }
  if (tenant?.phone) { right(tenant.phone, 9, font, grey); y -= 12; }
  if (tenant?.email) { right(tenant.email, 9, font, grey); y -= 12; }
  if (tenant?.vatNumber) { right(`VAT No. ${tenant.vatNumber}`, 9, font, grey); y -= 12; }

  y = 700;
  text(isInvoice ? 'Invoice to' : 'Prepared for', 50, 9, font, grey);
  y -= 14;
  text(customer?.name ?? '', 50, 12, bold);
  y -= 14;
  for (const line of [
    customer?.addressLine1,
    [customer?.city, customer?.region, customer?.postalCode].filter(Boolean).join(', '),
  ]) {
    if (line) { text(line, 50, 9, font, grey); y -= 12; }
  }
  y -= 4;
  text(`Ref: ${job.id.slice(0, 8).toUpperCase()}  ·  ${fmtDateTz(job.invoicedAt ?? job.createdAt, tenant?.timezone)}`, 50, 9, font, grey);
  y -= 10;
  text(job.title, 50, 12, bold);

  // Items table
  y -= 30;
  text('DESCRIPTION', 50, 8, bold, grey);
  text('QTY', 380, 8, bold, grey);
  text('PRICE', 430, 8, bold, grey);
  right('AMOUNT', 8, bold, grey);
  y -= 6;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.8, color: copper });
  y -= 16;
  for (const li of items) {
    text(li.description.slice(0, 60), 50, 10);
    text(String(li.quantity), 380, 10);
    text(money(li.unitPriceCents), 430, 10);
    right(money(Math.round(li.quantity * li.unitPriceCents)), 10);
    y -= 16;
    if (y < 160) break; // single-page v1
  }
  y -= 4;
  page.drawLine({ start: { x: 300, y }, end: { x: 545, y }, thickness: 0.5, color: grey });
  y -= 16;
  text('Subtotal', 380, 10);
  right(money(job.subtotalCents), 10);
  if (job.taxCents > 0) {
    y -= 14;
    text(`VAT (${((tenant?.taxRateBps ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}%)`, 380, 10);
    right(money(job.taxCents), 10);
  }
  if (job.depositPaidCents > 0) {
    y -= 14;
    text('Deposit received', 380, 10);
    right(`-${money(job.depositPaidCents)}`, 10);
  }
  y -= 18;
  text(isInvoice ? (job.status === 'paid' ? 'PAID' : 'Total due') : 'Quote total', 380, 12, bold, job.status === 'paid' ? rgb(0.1, 0.55, 0.35) : ink);
  right(money(Math.max(0, job.totalCents - (job.status === 'paid' ? job.totalCents : job.depositPaidCents))), 12, bold);

  if (job.quoteAcceptedAt && !isInvoice) {
    y -= 24;
    text(`Accepted by ${job.quoteAcceptedName ?? 'customer'} on ${fmtDateTz(job.quoteAcceptedAt, tenant?.timezone)}`, 50, 9, font, grey);
  }
  y = 60;
  text('Generated by Pocket Ops', 50, 8, font, grey);

  const bytes = await pdf.save();
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${isInvoice ? 'invoice' : 'quote'}-${job.id.slice(0, 8)}.pdf"`,
    },
  });
};
