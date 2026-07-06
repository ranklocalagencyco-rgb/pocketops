/**
 * Disconnect an accounting provider: revoke the tokens with the provider
 * (Intuit/Xero both require in-app disconnect for their reviews), wipe the
 * stored credentials, and mark the connection revoked. The row is kept —
 * ledger_sync_records reference it — and reconnecting upserts it back to
 * active via the callback.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../../db';
import { accountingConnections } from '../../../../db/schema';
import { isProvider, revokeTokens } from '../../../../lib/accounting';

export const POST: APIRoute = async ({ params, locals, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const provider = params.provider ?? '';
  if (!isProvider(provider)) return new Response('Not found', { status: 404 });

  const tenantId = locals.tenantId!;
  const db = createDb(env.DB);
  const [conn] = await db
    .select()
    .from(accountingConnections)
    .where(
      tenantWhere(
        accountingConnections,
        tenantId,
        and(eq(accountingConnections.provider, provider), eq(accountingConnections.status, 'active')),
      ),
    )
    .limit(1);

  if (conn) {
    try {
      await revokeTokens(provider, env, conn.refreshToken);
    } catch {
      // Provider unreachable — still cut the connection locally
    }
    await db
      .update(accountingConnections)
      .set({ status: 'revoked', accessToken: '', refreshToken: '', updatedAt: new Date() })
      .where(tenantWhere(accountingConnections, tenantId, eq(accountingConnections.id, conn.id)));
  }

  return redirect(`/dashboard/settings/accounting?disconnected=${provider}`, 302);
};
