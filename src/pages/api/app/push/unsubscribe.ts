/**
 * Remove this device's push registration. Tenant-scoped so a request can
 * only ever delete rows belonging to the caller's own company.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../../db';
import { pushSubscriptions } from '../../../../db/schema';

export const POST: APIRoute = async ({ request, locals }) => {
  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!body.endpoint) {
    return new Response(JSON.stringify({ error: 'Missing endpoint' }), { status: 400 });
  }

  const db = createDb(env.DB);
  await db
    .delete(pushSubscriptions)
    .where(tenantWhere(pushSubscriptions, locals.tenantId!, eq(pushSubscriptions.endpoint, body.endpoint)));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
