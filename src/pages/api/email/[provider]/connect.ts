/** Start the OAuth flow for a Gmail/Outlook mailbox (owner/admin only). */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { buildEmailAuthorizeUrl, emailProviderConfigured, isEmailProvider } from '../../../../lib/email';
import { newId } from '../../../../lib/ids';

export const GET: APIRoute = async ({ params, locals, cookies, url, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const provider = params.provider ?? '';
  if (!isEmailProvider(provider) || !emailProviderConfigured(provider, env)) {
    return new Response('Provider not configured', { status: 404 });
  }
  const state = newId();
  cookies.set('pocketops_email_state', `${provider}:${state}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  const redirectUri = `${env.APP_URL || url.origin}/api/email/${provider}/callback`;
  return redirect(buildEmailAuthorizeUrl(provider, env, redirectUri, state), 302);
};
