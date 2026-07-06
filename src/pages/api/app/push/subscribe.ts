/**
 * Register this device for push notifications. Body = the browser's
 * PushSubscription JSON. Endpoint is globally unique per device+origin, so
 * re-subscribing replaces the old row (also handles a device changing user).
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantValues } from '../../../../db';
import { pushSubscriptions } from '../../../../db/schema';
import { newId } from '../../../../lib/ids';

export const POST: APIRoute = async ({ request, locals }) => {
  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const endpoint = body.endpoint ?? '';
  const p256dh = body.keys?.p256dh ?? '';
  const auth = body.keys?.auth ?? '';
  if (!endpoint.startsWith('https://') || !p256dh || !auth) {
    return new Response(JSON.stringify({ error: 'Invalid subscription' }), { status: 400 });
  }

  const db = createDb(env.DB);
  // Replace any previous registration of this device, whoever owned it
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  await db.insert(pushSubscriptions).values(
    tenantValues(locals.tenantId!, {
      id: newId(),
      userId: locals.userId!,
      endpoint,
      p256dh,
      auth,
    }),
  );
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
