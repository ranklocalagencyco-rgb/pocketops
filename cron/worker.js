/**
 * Pocket Ops daily-automations trigger. A deliberately tiny separate Worker:
 * the main app is deployed by Workers Builds from the Astro adapter's config,
 * which only exports a fetch handler — cron triggers need this scheduled one.
 *
 * Deploy (one-time, from repo root):
 *   npx wrangler deploy --config cron/wrangler.jsonc
 *   npx wrangler secret put CRON_SECRET --config cron/wrangler.jsonc
 *
 * Fires 06:00 UTC daily (7am UK summer, 6am winter) → invoice chasing,
 * recurring-job spawning, and email sync in the main app.
 */
export default {
  async scheduled(event, env) {
    // Two triggers share this worker: the 17:00 UTC one is the evening
    // "tomorrow's jobs" digest, everything else is the morning automations
    const task = event.cron === '0 17 * * *' ? 'evening' : 'daily';
    const res = await fetch(`${env.APP_URL}/api/cron/daily?task=${task}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const body = await res.text();
    console.log(`${task} automations → ${res.status} ${body}`);
    // Throwing marks the invocation failed in the dashboard's cron metrics
    if (!res.ok) throw new Error(`${task} automations failed: ${res.status}`);
  },
};
