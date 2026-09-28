/**
 * Serve a job photo from R2 — tenant-scoped lookup, never a raw key from the
 * client, so cross-tenant reads are impossible.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../../db';
import { jobPhotos } from '../../../../db/schema';
import { fileResponse } from '../../../../media/serve';

export const GET: APIRoute = async ({ params, locals }) => {
  const tenantId = locals.tenantId!;
  const [photo] = await createDb(env.DB)
    .select()
    .from(jobPhotos)
    .where(tenantWhere(jobPhotos, tenantId, eq(jobPhotos.id, params.id ?? '')))
    .limit(1);
  if (!photo) return new Response('Not found', { status: 404 });

  const object = await env.FILES.get(photo.r2Key);
  if (!object) return new Response('Not found', { status: 404 });

  return fileResponse(object, photo.contentType, `photo-${photo.id}`);
};
