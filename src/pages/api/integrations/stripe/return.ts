/**
 * Return leg of Stripe Connect onboarding: sync charges_enabled from the
 * connected account, then land back on the Payments settings page.
 * (Stripe's return_url doesn't guarantee onboarding finished — the account
 * retrieve is the source of truth.)
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb } from '../../../../db';
import { tenants } from '../../../../db/schema';
import { getStripe } from '../../../../lib/stripe';

export const GET: APIRoute = async ({ locals, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const stripe = getStripe(env);
  const db = createDb(env.DB);
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, locals.tenantId!))
    .limit(1);

  if (stripe && tenant?.stripeAccountId) {
    try {
      const account = await stripe.accounts.retrieve(tenant.stripeAccountId);
      await db
        .update(tenants)
        .set({ stripeChargesEnabled: Boolean(account.charges_enabled) })
        .where(eq(tenants.id, tenant.id));
    } catch (err) {
      // Leave the flag as-is; the Payments page re-checks on load
      console.error('[stripe-return]', err instanceof Error ? err.message : String(err));
    }
  }
  return redirect('/dashboard/settings/payments', 302);
};
