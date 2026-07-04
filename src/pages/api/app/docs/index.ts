/** Company document upload → R2 (owner/admin only). */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb, tenantValues } from '../../../../db';
import { tenantDocuments } from '../../../../db/schema';
import { newClientToken, newId } from '../../../../lib/ids';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = (type: string) =>
  type === 'application/pdf' ||
  type.startsWith('image/') ||
  type.includes('officedocument') ||
  type === 'application/msword';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const tenantId = locals.tenantId!;
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0 || !ALLOWED(file.type)) {
    return redirect('/dashboard/settings/documents?error=type', 303);
  }
  if (file.size > MAX_BYTES) {
    return redirect('/dashboard/settings/documents?error=size', 303);
  }

  const docId = newId();
  const r2Key = `${tenantId}/docs/${docId}`;
  await env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } });
  await createDb(env.DB)
    .insert(tenantDocuments)
    .values(
      tenantValues(tenantId, {
        id: docId,
        name: (String(form.get('name') ?? '').trim() || file.name).slice(0, 100),
        r2Key,
        contentType: file.type,
        sizeBytes: file.size,
        shareToken: newClientToken(),
        showOnPortal: String(form.get('showOnPortal') ?? '') === '1',
        uploadedBy: locals.userId,
      }),
    );
  return redirect('/dashboard/settings/documents', 303);
};
