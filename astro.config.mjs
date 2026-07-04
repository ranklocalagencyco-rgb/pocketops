import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // Exposes wrangler.jsonc bindings (D1) to `astro dev` via miniflare
    platformProxy: { enabled: true },
  }),
  vite: {
    plugins: [tailwindcss()],
  },
});
