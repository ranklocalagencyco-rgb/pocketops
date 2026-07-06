/**
 * Transactional email (password reset) via the Resend HTTP API — no domain
 * verification required to start (Resend's shared `onboarding@resend.dev`
 * sender works immediately); swap EMAIL_FROM to a pocketops.io address once
 * the domain is attached and verified in Resend.
 */
export function mailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export async function sendMail(
  env: Env,
  opts: { to: string; subject: string; text: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  const from = env.EMAIL_FROM || 'Pocket Ops <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, text: opts.text }),
    });
    if (!res.ok) return { ok: false, error: `Resend send failed: ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
