/**
 * Profile-photo route — sits under /api/app so middleware requires a session,
 * and the query is tenant-scoped so one company can never load another's
 * photos. Any signed-in teammate can see a colleague's avatar.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../../db';
import { users } from '../../../../db/schema';

export const GET: APIRoute = async ({ params, locals }) => {
  const userId = params.userId ?? '';
  if (!userId) return new Response('Not found', { status: 404 });

  const db = createDb(env.DB);
  const [user] = await db
    .select({ avatarR2Key: users.avatarR2Key, avatarContentType: users.avatarContentType })
    .from(users)
    .where(tenantWhere(users, locals.tenantId!, eq(users.id, userId)))
    .limit(1);
  if (!user?.avatarR2Key) return new Response('Not found', { status: 404 });

  const obj = await env.FILES.get(user.avatarR2Key);
  if (!obj) return new Response('Not found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': user.avatarContentType ?? 'image/png',
      'Cache-Control': 'private, max-age=300',
    },
  });
};
