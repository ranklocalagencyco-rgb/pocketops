/**
 * Web Push for Cloudflare Workers — no Node crypto, pure WebCrypto.
 * Implements VAPID (RFC 8292, ES256 JWT) and payload encryption
 * (RFC 8291, aes128gcm). Keys come from Worker secrets:
 *   VAPID_PUBLIC_KEY  — base64url raw uncompressed P-256 point (65 bytes)
 *   VAPID_PRIVATE_KEY — base64url private scalar `d` (32 bytes)
 * Generate a pair with `node scripts/generate-vapid.mjs`.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, browser's public key
  auth: string; // base64url, 16-byte auth secret
}

export interface PushPayload {
  title: string;
  body: string;
  url: string; // where a tap takes the user
  tag?: string; // collapses duplicate notifications
}

export function pushConfigured(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string }): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

const VAPID_SUBJECT = 'mailto:support@pocketops.io';
const encoder = new TextEncoder();

function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64u(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Signed VAPID JWT for the push service origin (RFC 8292). */
async function vapidAuthHeader(endpointOrigin: string, publicKeyB64u: string, privateDB64u: string): Promise<string> {
  // The public key is the raw point 0x04 || x || y — rebuild the JWK from it
  // plus the private scalar, so both secrets stay plain base64url strings
  const pub = b64uToBytes(publicKeyB64u);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64u(pub.slice(1, 33)),
      y: bytesToB64u(pub.slice(33, 65)),
      d: privateDB64u,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = bytesToB64u(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(
    encoder.encode(
      JSON.stringify({
        aud: endpointOrigin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: VAPID_SUBJECT,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto ECDSA emits the raw r||s form JWT wants — no DER wrangling
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(signingInput),
  );
  return `vapid t=${signingInput}.${bytesToB64u(sig)}, k=${publicKeyB64u}`;
}

/** Encrypt a payload for one subscription (RFC 8291 aes128gcm). */
async function encryptPayload(sub: PushSubscriptionKeys, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublicRaw = b64uToBytes(sub.p256dh); // 65-byte uncompressed point
  const authSecret = b64uToBytes(sub.auth); // 16 bytes

  const asKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublicRaw as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeys.privateKey, 256),
  );

  // RFC 8291 key schedule
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // Single record: payload + 0x02 delimiter (final record marker)
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, record as BufferSource),
  );

  // aes128gcm content-coding header: salt | record size (u32be) | key id
  const headerBlock = new Uint8Array(16 + 4 + 1 + asPublicRaw.length);
  headerBlock.set(salt, 0);
  new DataView(headerBlock.buffer).setUint32(16, 4096);
  headerBlock[20] = asPublicRaw.length;
  headerBlock.set(asPublicRaw, 21);
  return concat(headerBlock, ciphertext);
}

/**
 * Send one push. Returns 'ok', 'gone' (subscription dead — delete it), or
 * 'error'. Never throws.
 */
export async function sendWebPush(
  env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string },
  sub: PushSubscriptionKeys,
  payload: PushPayload,
  urgency: 'high' | 'normal' = 'normal',
): Promise<'ok' | 'gone' | 'error'> {
  if (!pushConfigured(env)) return 'error';
  try {
    const endpoint = new URL(sub.endpoint);
    const body = await encryptPayload(sub, encoder.encode(JSON.stringify(payload)));
    const auth = await vapidAuthHeader(endpoint.origin, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: urgency,
      },
      body: body as BodyInit,
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
