/**
 * Job photo upload → R2. Auth enforced by middleware (/api/app is protected).
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantValues, tenantWhere } from '../../../../db';
import { jobPhotos, jobs } from '../../../../db/schema';
import { newId } from '../../../../lib/ids';
import { PHOTO_TYPES, sniffType } from '../../../../media/sniff';

const MAX_BYTES = 8 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals, url, redirect }) => {
  const tenantId = locals.tenantId!;
  const jobId = url.searchParams.get('jobId') ?? '';

  const [job] = await createDb(env.DB)
    .select({ id: jobs.id, assignedUserId: jobs.assignedUserId })
    .from(jobs)
    .where(tenantWhere(jobs, tenantId, eq(jobs.id, jobId)))
    .limit(1);
  if (!job) return new Response('Not found', { status: 404 });
  const isFieldRole = locals.userRole === 'technician' || locals.userRole === 'apprentice';
  if (isFieldRole && job.assignedUserId !== locals.userId) {
    return new Response('Not found', { status: 404 });
  }

  const form = await request.formData();
  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return redirect(`/dashboard/jobs/${jobId}`, 303);
  }
  if (file.size > MAX_BYTES) return new Response('Photo too large (8MB max)', { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffType(bytes);
  if (!contentType || !PHOTO_TYPES.has(contentType)) {
    return new Response('Photos must be JPEG, PNG, WebP or HEIC images', { status: 415 });
  }

  const photoId = newId();
  const r2Key = `${tenantId}/${jobId}/${photoId}`;
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType } });
  await createDb(env.DB)
    .insert(jobPhotos)
    .values(
      tenantValues(tenantId, {
        id: photoId,
        jobId,
        r2Key,
        contentType,
        uploadedBy: locals.userId,
      }),
    );

  return redirect(`/dashboard/jobs/${jobId}`, 303);
};
