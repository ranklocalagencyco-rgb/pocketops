/**
 * ID and token generation. NanoID uses Web Crypto (crypto.getRandomValues),
 * which is available in Cloudflare V8 isolates — no Node crypto anywhere.
 */
import { nanoid } from 'nanoid';

/** Internal primary keys. */
export function newId(): string {
  return nanoid(); // 21 chars, ~126 bits of entropy
}

/**
 * Public magic-link tokens (jobs.clientToken). 24 chars > the 21-char
 * minimum — unguessable at internet scale.
 */
export function newClientToken(): string {
  return nanoid(24);
}

/** Raw session token for the pocketops_session_token cookie (Module 2). */
export function newSessionToken(): string {
  return nanoid(32);
}

/** SHA-256 hex digest — sessions store only this, never the raw token. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
