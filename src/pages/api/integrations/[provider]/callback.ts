/**
 * OAuth2 callback: state check, code exchange, connection upsert (Module 9).
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantValues, tenantWhere } from '../../../../db';
import { accountingConnections } from '../../../../db/schema';
import { exchangeCode, fetchXeroTenantId, isProvider } from '../../../../lib/accounting';
import { newId } from '../../../../lib/ids';

export const GET: APIRoute = async ({ params, locals, cookies, url, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const provider = params.provider ?? '';
  if (!isProvider(provider)) return new Response('Not found', { status: 404 });

  const tenantId = locals.tenantId!;

  const expected = cookies.get('pocketops_oauth_state')?.value;
  cookies.delete('pocketops_oauth_state', { path: '/' });
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!code || !state || expected !== `${provider}:${state}`) {
    return redirect('/dashboard/settings?error=oauth', 302);
  }

  try {
    const redirectUri = `${env.APP_URL || url.origin}/api/integrations/${provider}/callback`;
    const tokens = await exchangeCode(provider, env, code, redirectUri);

    // QBO passes realmId as a query param; Xero exposes it via /connections
    const externalRealmId =
      provider === 'quickbooks'
        ? url.searchParams.get('realmId')
        : await fetchXeroTenantId(tokens.access_token);

    const db = createDb(env.DB);
    const values = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      externalRealmId,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      status: 'active' as const,
      updatedAt: new Date(),
    };
    const [existing] = await db
      .select({ id: accountingConnections.id })
      .from(accountingConnections)
      .where(tenantWhere(accountingConnections, tenantId, eq(accountingConnections.provider, provider)))
      .limit(1);
    if (existing) {
      await db
        .update(accountingConnections)
        .set(values)
        .where(tenantWhere(accountingConnections, tenantId, eq(accountingConnections.id, existing.id)));
    } else {
      await db
        .insert(accountingConnections)
        .values(tenantValues(tenantId, { id: newId(), provider, ...values }));
    }
    return redirect(`/dashboard/settings/accounting?connected=${provider}`, 302);
  } catch {
    return redirect('/dashboard/settings/accounting?error=oauth', 302);
  }
};
