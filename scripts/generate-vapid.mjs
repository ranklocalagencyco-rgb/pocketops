/**
 * Generate a VAPID key pair for Web Push and write it into .dev.vars
 * (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Prints ONLY the public key —
 * the private key never appears on screen.
 *
 * After running, upload both to the production Worker from Git Bash
 * (PowerShell pipes add a BOM that corrupts secrets):
 *   val=$(node -e "console.log(require('fs').readFileSync('.dev.vars','utf8').match(/^VAPID_PRIVATE_KEY=\"?([^\"\r\n]+)/m)[1])")
 *   printf '%s' "$val" | npx wrangler secret put VAPID_PRIVATE_KEY
 * (same for VAPID_PUBLIC_KEY)
 */
import { webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const publicRaw = b64u(await webcrypto.subtle.exportKey('raw', pair.publicKey));
const privateD = jwk.d; // already base64url

const file = '.dev.vars';
let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
for (const [key, value] of [
  ['VAPID_PUBLIC_KEY', publicRaw],
  ['VAPID_PRIVATE_KEY', privateD],
]) {
  const line = `${key}="${value}"`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
}
writeFileSync(file, text);

console.log('VAPID keys written to .dev.vars');
console.log(`Public key: ${publicRaw}`);
