/**
 * Public company-logo route — customers see it on quote/invoice portals and
 * the client hub, so it can't sit behind auth. Slug is already public (it's
 * the booking-page URL); the logo is the business's public branding.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb } from '../../db';
import { tenants } from '../../db/schema';

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug ?? '';
  if (!slug) return new Response('Not found', { status: 404 });

  const db = createDb(env.DB);
  const [tenant] = await db
    .select({ logoR2Key: tenants.logoR2Key, logoContentType: tenants.logoContentType })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant?.logoR2Key) return new Response('Not found', { status: 404 });

  const obj = await env.FILES.get(tenant.logoR2Key);
  if (!obj) return new Response('Not found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': tenant.logoContentType ?? 'image/png',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
