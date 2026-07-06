/**
 * Astro Content Collections. `help` holds the in-app guides under
 * src/content/help — one markdown file per core module, rendered at
 * /dashboard/help/[slug]. The entry id (filename) must match the AppShell
 * `active` id so the topbar "?" can deep-link to the right guide.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const help = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/help' }),
  schema: z.object({
    title: z.string(),
    module: z.enum(['dashboard', 'schedule', 'jobs', 'inbox', 'customers', 'settings']),
    order: z.number(),
    summary: z.string(),
  }),
});

export const collections = { help };
