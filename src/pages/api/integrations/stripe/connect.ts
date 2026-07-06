/**
 * Stripe Connect onboarding (Standard accounts).
 *
 * Payments settle in the tenant's OWN Stripe account — Pocket Ops never
 * holds their money and Stripe handles their KYC, payouts, and disputes.
 * First visit creates the connected account and stores its id; every visit
 * mints a fresh Account Link (they expire quickly and are single-use) and
 * redirects to Stripe-hosted onboarding.
 *
 * Behind the auth middleware; owner/admin only.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb } from '../../../../db';
import { tenants } from '../../../../db/schema';
import { getStripe } from '../../../../lib/stripe';

export const GET: APIRoute = async ({ locals, url, redirect }) => {
  if (locals.userRole !== 'owner' && locals.userRole !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  const stripe = getStripe(env);
  if (!stripe) return new Response('Stripe not configured', { status: 503 });

  const db = createDb(env.DB);
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, locals.tenantId!))
    .limit(1);
  if (!tenant) return new Response('Not found', { status: 404 });

  const origin = env.APP_URL || url.origin;
  try {
    let accountId = tenant.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        country: 'GB',
        email: tenant.email ?? undefined,
        business_profile: { name: tenant.name },
        metadata: { tenantId: tenant.id },
      });
      accountId = account.id;
      await db
        .update(tenants)
        .set({ stripeAccountId: accountId })
        .where(eq(tenants.id, tenant.id));
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${origin}/api/integrations/stripe/connect`,
      return_url: `${origin}/api/integrations/stripe/return`,
    });
    return redirect(link.url, 302);
  } catch {
    return redirect('/dashboard/settings/payments?error=stripe', 302);
  }
};
