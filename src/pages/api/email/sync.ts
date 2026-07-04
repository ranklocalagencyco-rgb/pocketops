/** Pull new customer emails into the inbox for the current tenant. */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../db';
import { emailAccounts } from '../../../db/schema';
import { syncEmailAccount } from '../../../lib/email';

export const POST: APIRoute = async ({ locals }) => {
  const tenantId = locals.tenantId!;
  const db = createDb(env.DB);
  const accounts = await db
    .select()
    .from(emailAccounts)
    .where(tenantWhere(emailAccounts, tenantId, eq(emailAccounts.status, 'active')));

  let ingested = 0;
  const errors: string[] = [];
  for (const account of accounts) {
    try {
      ingested += await syncEmailAccount(db, env, account);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      await db
        .update(emailAccounts)
        .set({ status: 'error' })
        .where(tenantWhere(emailAccounts, tenantId, eq(emailAccounts.id, account.id)));
    }
  }
  return new Response(JSON.stringify({ accounts: accounts.length, ingested, errors }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
