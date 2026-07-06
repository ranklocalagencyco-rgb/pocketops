import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  // Astro's origin check 403s form-encoded POSTs that lack a matching Origin
  // header — which is exactly what Twilio's webhooks are. CSRF is already
  // covered without it: the session cookie is SameSite=Strict (cross-site
  // POSTs carry no session), webhooks are signature-validated, and the cron
  // endpoint requires a Bearer secret.
  security: { checkOrigin: false },
  adapter: cloudflare({
    // Exposes wrangler.jsonc bindings (D1) to `astro dev` via miniflare
    platformProxy: { enabled: true },
  }),
  vite: {
    plugins: [tailwindcss()],
  },
});
