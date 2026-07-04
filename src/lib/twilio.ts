/**
 * Twilio without the Node SDK — plain fetch + Web Crypto, isolate-safe.
 */

export function twilioConfigured(env: Env): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

export async function sendSms(
  env: Env,
  opts: { to: string; from: string; body: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!twilioConfigured(env)) return { ok: false, error: 'Twilio not configured' };
  const sid = env.TWILIO_ACCOUNT_SID!;
  const auth = btoa(`${sid}:${env.TWILIO_AUTH_TOKEN}`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: opts.to, From: opts.from, Body: opts.body }),
  });
  if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${await res.text()}` };
  return { ok: true };
}

/**
 * Validate X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted
 * form params concatenated as key+value)). Rejecting bad signatures keeps
 * the text-back endpoint from being a free SMS cannon.
 */
export async function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
