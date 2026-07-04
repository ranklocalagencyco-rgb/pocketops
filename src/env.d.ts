/// <reference types="astro/client" />
// Env + Cloudflare runtime globals come from worker-configuration.d.ts
// (regenerate with `npx wrangler types` after changing wrangler.jsonc).

type Runtime = import('@astrojs/cloudflare').Runtime;

declare namespace App {
  interface Locals extends Runtime {
    /** Populated by src/middleware.ts (Module 2) for authenticated requests. */
    tenantId: string | null;
    userId: string | null;
    userRole: import('./db/schema').UserRole | null;
  }
}
