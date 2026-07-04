import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../../db';
import { certificates, customers, jobs, tenants } from '../../../../db/schema';
import { renderCertPdf } from '../../../../lib/cert-pdf';

export const GET: APIRoute = async ({ params, locals }) => {
  const tenantId = locals.tenantId!;
  const db = createDb(env.DB);
  const [cert] = await db
    .select()
    .from(certificates)
    .where(tenantWhere(certificates, tenantId, eq(certificates.id, params.certId ?? '')))
    .limit(1);
  if (!cert) return new Response('Not found', { status: 404 });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const [customer] = await db
    .select()
    .from(customers)
    .where(tenantWhere(customers, tenantId, eq(customers.id, cert.customerId)))
    .limit(1);
  const [job] = await db
    .select({ title: jobs.title })
    .from(jobs)
    .where(tenantWhere(jobs, tenantId, eq(jobs.id, cert.jobId)))
    .limit(1);

  const bytes = await renderCertPdf(cert, tenant, customer, job?.title ?? '');
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${cert.certNumber}.pdf"`,
    },
  });
};
