/**
 * AI assist (Cloudflare Workers AI — no external API key needed).
 * mode "reply": draft a response to the latest customer message in a thread.
 */
import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { desc, eq } from 'drizzle-orm';
import { createDb, tenantWhere } from '../../../db';
import { messages, tenants } from '../../../db/schema';

export const POST: APIRoute = async ({ request, locals }) => {
  const tenantId = locals.tenantId!;
  const { mode, phone } = (await request.json()) as { mode: string; phone?: string };
  if (mode !== 'reply' || !phone) return new Response('Bad request', { status: 400 });

  const db = createDb(env.DB);
  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const thread = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(tenantWhere(messages, tenantId, eq(messages.phone, phone)))
    .orderBy(desc(messages.createdAt))
    .limit(6);
  if (thread.length === 0) return new Response('No thread', { status: 404 });

  const transcript = thread
    .reverse()
    .map((m) => `${m.direction === 'in' ? 'Customer' : 'Us'}: ${m.body.slice(0, 400)}`)
    .join('\n');

  // AI binding is optional — configured in the Cloudflare dashboard for prod
  const ai = (env as Env & { AI?: Ai }).AI;
  if (!ai) {
    return new Response(JSON.stringify({ error: 'AI unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const result = (await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: `You draft short, friendly, professional replies for ${tenant?.name ?? 'a UK trades business'}. Plain UK English, no fluff, no sign-off longer than a first name, under 80 words. Reply with ONLY the message text.`,
        },
        { role: 'user', content: `Conversation so far:\n${transcript}\n\nDraft our next reply.` },
      ],
      max_tokens: 200,
    })) as { response?: string };
    const draft = (result.response ?? '').trim();
    if (!draft) throw new Error('empty');
    return new Response(JSON.stringify({ draft }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'AI unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
