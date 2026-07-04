/**
 * Global Auth Shield (Module 2).
 *
 * Every request passes through here. Protected prefixes require a valid
 * pocketops_session_token cookie; any tamper, expiry, or unexpected error
 * fails CLOSED: all session cookies dropped, a safe 401 for API-style
 * requests, and a total redirect to /login for browser navigations.
 * Zero error detail ever leaks from the V8 isolate.
 */
import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { createDb } from './db';
import { SESSION_COOKIE, validateSessionToken } from './lib/session';

const PROTECTED_PREFIXES = ['/dashboard', '/api/integrations', '/api/app', '/api/email'];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Drop all session cookies; 401 for API clients, redirect for browsers. */
function failClosed(context: APIContext): Response {
  context.cookies.delete(SESSION_COOKIE, { path: '/' });
  const wantsHtml = context.request.headers.get('accept')?.includes('text/html') ?? false;
  if (wantsHtml) return context.redirect('/login', 302);
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.tenantId = null;
  context.locals.userId = null;
  context.locals.userRole = null;

  const pathname = context.url.pathname;
  const token = context.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      const db = createDb(env.DB);
      const result = await validateSessionToken(db, token);
      if (result) {
        context.locals.tenantId = result.session.tenantId;
        context.locals.userId = result.user.id;
        context.locals.userRole = result.user.role;
      } else {
        // Stale or tampered token: always drop it
        context.cookies.delete(SESSION_COOKIE, { path: '/' });
      }
    } catch {
      // Fail-safe catch block: never let an auth error leak downstream
      if (isProtected(pathname)) return failClosed(context);
      context.cookies.delete(SESSION_COOKIE, { path: '/' });
    }
  }

  if (isProtected(pathname) && !context.locals.userId) {
    return failClosed(context);
  }

  return next();
});
