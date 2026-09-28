import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with local, per-test-file D1/R2/KV storage. Bindings
// are declared here rather than read from wrangler.jsonc because the AI binding
// there is remote-only and would need a Cloudflare login (and secrets in CI).
// No test calls Workers AI, so it is simply left unbound.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-06-01',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        r2Buckets: ['FILES'],
        kvNamespaces: ['SESSION'],
        bindings: {
          // The real drizzle/ migrations — the same SQL production runs.
          TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL('./drizzle', import.meta.url))),
        },
      },
    })),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/apply-migrations.ts'],
  },
});
