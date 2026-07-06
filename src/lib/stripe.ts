/**
 * Stripe on Cloudflare Workers: fetch HTTP client + SubtleCrypto provider.
 * The sync `constructEvent` uses Node crypto and fails in isolates — the
 * webhook MUST use `constructEventAsync` with the subtle crypto provider.
 */
import Stripe from 'stripe';

export function getStripe(env: Env): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export const webhookCryptoProvider = Stripe.createSubtleCryptoProvider();

/**
 * Optional platform fee on Connect direct charges, in basis points
 * (PLATFORM_FEE_BPS=100 → 1% of each payment). Unset or 0 = no fee.
 */
export function platformFeeCents(env: Env, amountCents: number): number {
  const bps = Number((env as Env & { PLATFORM_FEE_BPS?: string }).PLATFORM_FEE_BPS ?? 0);
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return Math.min(Math.round((amountCents * bps) / 10_000), amountCents);
}
