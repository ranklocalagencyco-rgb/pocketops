/**
 * The one way stored files are sent to a browser. Whatever a file really
 * contains, the browser is told exactly what it is, may not guess otherwise,
 * and can never run it as a page on our origin.
 */
import { DOCX_TYPE, PPTX_TYPE, XLSX_TYPE } from './sniff';

/**
 * Opaque origin with no scripts, plugins, forms or network access. Inline
 * styles are allowed so the browser's own image viewer can centre a picture.
 * Chromium's built-in PDF viewer still renders under this policy.
 */
const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** Extensions per type; the first is added to a download name that lacks one. */
const EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic', '.heif'],
  'image/heif': ['.heif', '.heic'],
  // No longer accepted for upload, but older photos may be stored as these.
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
  'image/bmp': ['.bmp'],
  'application/pdf': ['.pdf'],
  [DOCX_TYPE]: ['.docx'],
  [XLSX_TYPE]: ['.xlsx'],
  [PPTX_TYPE]: ['.pptx'],
  'application/msword': ['.doc'],
};

/** Only these may be displayed in the tab; every other known type is a download. */
const INLINE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/avif',
  'image/bmp',
  'application/pdf',
]);

const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

function normalise(type: string): string {
  const bare = type.split(';')[0].trim().toLowerCase();
  return ALIASES[bare] ?? bare;
}

/**
 * Headers for a stored file. Unknown or unsafe stored types (SVG, HTML, XML,
 * anything else older uploads may have claimed) are served as an opaque
 * download, so the bytes stay retrievable but nothing renders.
 */
export function fileHeaders(storedType: string, filename: string): Headers {
  const type = normalise(storedType);
  const extensions = EXTENSIONS[type];
  return new Headers({
    'Content-Type': extensions ? type : 'application/octet-stream',
    'Content-Disposition': contentDisposition(INLINE.has(type) ? 'inline' : 'attachment', filename, extensions),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': FILE_CSP,
    'Cache-Control': 'private, max-age=3600',
  });
}

export function fileResponse(object: R2ObjectBody, storedType: string, filename: string): Response {
  return new Response(object.body as unknown as BodyInit, { headers: fileHeaders(storedType, filename) });
}

/** RFC 6266: an ASCII-only `filename` for old clients plus the exact UTF-8 name in `filename*`. */
function contentDisposition(kind: 'inline' | 'attachment', rawName: string, extensions?: string[]): string {
  let name = rawName.replace(/[\p{Cc}\p{Cs}]/gu, '').trim() || 'download';
  if (extensions && !extensions.some((ext) => name.toLowerCase().endsWith(ext))) name += extensions[0];
  let ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '').trim();
  if (!ascii || extensions?.includes(ascii.toLowerCase())) ascii = `download${ascii}`;
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
