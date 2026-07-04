/** OAuth callback: state check, token exchange, mailbox upsert. */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantValues, tenantWhere } from '../../../../db';
import { emailAccounts } from '../../../../db/schema';
import { exchangeEmailCode, fetchMailboxAddress, isEmailProvider } from '../../../../lib/email';
import { newId } from '../../../../lib/ids';

export const GET: APIRoute = async ({ params, locals, cookies, url, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const provider = params.provider ?? '';
  if (!isEmailProvider(provider)) return new Response('Not found', { status: 404 });
  const tenantId = locals.tenantId!;

  const expected = cookies.get('pocketops_email_state')?.value;
  cookies.delete('pocketops_email_state', { path: '/' });
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!code || !state || expected !== `${provider}:${state}`) {
    return redirect('/dashboard/settings/email?error=oauth', 302);
  }

  try {
    const redirectUri = `${env.APP_URL || url.origin}/api/email/${provider}/callback`;
    const tokens = await exchangeEmailCode(provider, env, code, redirectUri);
    const emailAddress = await fetchMailboxAddress(provider, tokens.access_token);
    if (!emailAddress || !tokens.refresh_token) {
      return redirect('/dashboard/settings/email?error=oauth', 302);
    }
    const db = createDb(env.DB);
    const values = {
      emailAddress,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      status: 'active' as const,
      updatedAt: new Date(),
    };
    const [existing] = await db
      .select({ id: emailAccounts.id })
      .from(emailAccounts)
      .where(tenantWhere(emailAccounts, tenantId, eq(emailAccounts.provider, provider)))
      .limit(1);
    if (existing) {
      await db
        .update(emailAccounts)
        .set(values)
        .where(tenantWhere(emailAccounts, tenantId, eq(emailAccounts.id, existing.id)));
    } else {
      await db
        .insert(emailAccounts)
        .values(tenantValues(tenantId, { id: newId(), provider, ...values }));
    }
    return redirect(`/dashboard/settings/email?connected=${provider}`, 302);
  } catch {
    return redirect('/dashboard/settings/email?error=oauth', 302);
  }
};
