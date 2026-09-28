/** Serve a company document internally — tenant-scoped lookup. */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../../db';
import { tenantDocuments } from '../../../../db/schema';
import { fileResponse } from '../../../../media/serve';

export const GET: APIRoute = async ({ params, locals }) => {
  const [doc] = await createDb(env.DB)
    .select()
    .from(tenantDocuments)
    .where(tenantWhere(tenantDocuments, locals.tenantId!, eq(tenantDocuments.id, params.id ?? '')))
    .limit(1);
  if (!doc) return new Response('Not found', { status: 404 });
  const object = await env.FILES.get(doc.r2Key);
  if (!object) return new Response('Not found', { status: 404 });
  return fileResponse(object, doc.contentType, doc.name);
};
