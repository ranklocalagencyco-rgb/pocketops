/** Company document upload → R2 (owner/admin only). */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb, tenantValues } from '../../../../db';
import { tenantDocuments } from '../../../../db/schema';
import { newClientToken, newId } from '../../../../lib/ids';
import { DOCUMENT_TYPES, sniffType } from '../../../../media/sniff';

const MAX_BYTES = 10 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const tenantId = locals.tenantId!;
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return redirect('/dashboard/settings/documents?error=type', 303);
  }
  if (file.size > MAX_BYTES) {
    return redirect('/dashboard/settings/documents?error=size', 303);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffType(bytes);
  if (!contentType || !DOCUMENT_TYPES.has(contentType)) {
    return redirect('/dashboard/settings/documents?error=type', 303);
  }

  const docId = newId();
  const r2Key = `${tenantId}/docs/${docId}`;
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType } });
  await createDb(env.DB)
    .insert(tenantDocuments)
    .values(
      tenantValues(tenantId, {
        id: docId,
        name: (String(form.get('name') ?? '').trim() || file.name).slice(0, 100),
        r2Key,
        contentType,
        sizeBytes: file.size,
        shareToken: newClientToken(),
        showOnPortal: String(form.get('showOnPortal') ?? '') === '1',
        uploadedBy: locals.userId,
      }),
    );
  return redirect('/dashboard/settings/documents', 303);
};
