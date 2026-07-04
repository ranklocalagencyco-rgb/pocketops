/**
 * Start the OAuth2 flow for QuickBooks/Xero (Module 9).
 * Behind the auth middleware; owner/admin only.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { buildAuthorizeUrl, isProvider, providerConfigured } from '../../../../lib/accounting';
import { newId } from '../../../../lib/ids';

export const GET: APIRoute = async ({ params, locals, cookies, url, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const provider = params.provider ?? '';
  if (!isProvider(provider) || !providerConfigured(provider, env)) {
    return new Response('Provider not configured', { status: 404 });
  }

  const state = newId();
  cookies.set('pocketops_oauth_state', `${provider}:${state}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax', // OAuth redirect is a cross-site navigation
    path: '/',
    maxAge: 600,
  });
  const redirectUri = `${env.APP_URL || url.origin}/api/integrations/${provider}/callback`;
  return redirect(buildAuthorizeUrl(provider, env, redirectUri, state), 302);
};
