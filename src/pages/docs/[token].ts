/**
 * Public document share link — access proven by the unguessable token.
 * This is what a tradesman texts to a potential client asking to see
 * insurance, qualifications, or T&Cs.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb } from '../../db';
import { tenantDocuments } from '../../db/schema';

export const GET: APIRoute = async ({ params }) => {
  const token = params.token ?? '';
  if (token.length < 21) return new Response('Not found', { status: 404 });
  const [doc] = await createDb(env.DB)
    .select()
    .from(tenantDocuments)
    .where(eq(tenantDocuments.shareToken, token))
    .limit(1);
  if (!doc) return new Response('Not found', { status: 404 });
  const object = await env.FILES.get(doc.r2Key);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      'Content-Type': doc.contentType,
      'Content-Disposition': `inline; filename="${doc.name.replace(/[^\w. -]/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
};
