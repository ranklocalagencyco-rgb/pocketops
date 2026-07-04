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
