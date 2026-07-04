/**
 * Client IP without Astro.clientAddress (unsupported by the Cloudflare
 * adapter). Cloudflare always sets cf-connecting-ip at the edge.
 */
export function clientIp(request: Request): string | null {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}
