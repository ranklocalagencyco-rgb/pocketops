import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '../../../db';
import { destroySessionByToken, SESSION_COOKIE } from '../../../lib/session';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await destroySessionByToken(createDb(env.DB), token);
    } catch {
      // Cookie still gets dropped below — fail closed
    }
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/login', 302);
};
