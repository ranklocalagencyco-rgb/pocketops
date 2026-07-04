/** Public certificate PDF — access proven by the customer's portal token. */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../../db';
import { certificates, customers, jobs, tenants } from '../../../../db/schema';
import { renderCertPdf } from '../../../../lib/cert-pdf';

export const GET: APIRoute = async ({ params }) => {
  const token = params.token ?? '';
  if (token.length < 21) return new Response('Not found', { status: 404 });
  const db = createDb(env.DB);

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.portalToken, token))
    .limit(1);
  if (!customer) return new Response('Not found', { status: 404 });

  const [cert] = await db
    .select()
    .from(certificates)
    .where(
      tenantWhere(
        certificates,
        customer.tenantId,
        eq(certificates.id, params.certId ?? ''),
        eq(certificates.customerId, customer.id),
      ),
    )
    .limit(1);
  if (!cert) return new Response('Not found', { status: 404 });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, customer.tenantId)).limit(1);
  const [job] = await db
    .select({ title: jobs.title })
    .from(jobs)
    .where(tenantWhere(jobs, customer.tenantId, eq(jobs.id, cert.jobId)))
    .limit(1);

  const bytes = await renderCertPdf(cert, tenant, customer, job?.title ?? '');
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${cert.certNumber}.pdf"`,
    },
  });
};
