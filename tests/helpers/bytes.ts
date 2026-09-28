/**
 * Minimal byte fixtures for file-type tests. Each is the smallest input that
 * carries the real signature — enough for sniffing, not always a full image.
 */
import { zipSync, strToU8 } from 'fflate';

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));
const text = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** JFIF header + end-of-image marker. */
export const JPEG = hex('FF D8 FF E0 00 10 4A 46 49 46 00 01 01 00 00 01 00 01 00 00 FF D9');

/** A complete, valid 1x1 transparent PNG. */
export const PNG = hex(`
  89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52 00 00 00 01 00 00 00 01
  08 06 00 00 00 1F 15 C4 89 00 00 00 0A 49 44 41 54 78 9C 63 00 01 00 00
  05 00 01 0D 0A 2D B4 00 00 00 00 49 45 4E 44 AE 42 60 82`);

/** A complete, valid 1x1 lossless WebP. */
export const WEBP = concat(
  text('RIFF'),
  hex('1A 00 00 00'),
  text('WEBPVP8L'),
  hex('0D 00 00 00 2F 00 00 00 10 07 10 11 11 88 88 FE 07 00'),
);

/** ISO-BMFF `ftyp` box: size, 'ftyp', major brand, minor version, compatible brands. */
function ftyp(major: string, ...compatible: string[]) {
  const size = 16 + compatible.length * 4;
  return concat(
    hex(`00 00 00 ${size.toString(16).padStart(2, '0')}`),
    text('ftyp' + major),
    hex('00 00 00 00'),
    text(compatible.join('')),
    hex('00 00 00 08'),
    text('meta'),
  );
}

/** iPhone photo (HEIC). */
export const HEIC = ftyp('heic', 'mif1', 'heic');
/** Generic HEIF image (e.g. some Android cameras). */
export const HEIF = ftyp('mif1', 'mif1', 'miaf');
/** AVIF shares the HEIF container but is not an approved type. */
export const AVIF = ftyp('avif', 'mif1', 'avif', 'miaf');
/** MP4 video — no video in this slice. */
export const MP4 = ftyp('isom', 'isom', 'iso2', 'mp41');
/** iPhone .mov video. */
export const MOV = ftyp('qt  ', 'qt  ');

export const PDF = text(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
);

const CONTENT_TYPES = strToU8(
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
);
const xml = strToU8('<?xml version="1.0" encoding="UTF-8"?><root/>');

export const DOCX = zipSync({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': xml });
export const XLSX = zipSync({ '[Content_Types].xml': CONTENT_TYPES, 'xl/workbook.xml': xml });
export const PPTX = zipSync({ '[Content_Types].xml': CONTENT_TYPES, 'ppt/presentation.xml': xml });
/** Macro-enabled Word document (.docm) — carries VBA, never accepted. */
export const DOCM = zipSync({
  '[Content_Types].xml': CONTENT_TYPES,
  'word/document.xml': xml,
  'word/vbaProject.bin': hex('D0 CF 11 E0 A1 B1 1A E1'),
});
/** An ordinary ZIP archive (could hold anything). */
export const PLAIN_ZIP = zipSync({ 'readme.txt': strToU8('hello'), 'page.html': strToU8('<script>1</script>') });

/** Legacy Word 97-2003 (.doc) — OLE2 compound file signature. */
export const LEGACY_DOC = concat(hex('D0 CF 11 E0 A1 B1 1A E1'), new Uint8Array(504));

export const SVG = text(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)">' +
    '<script>fetch("/api/app/export/backup")</script></svg>',
);
export const SVG_NO_PROLOG = text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const HTML = text('<!doctype html><html><body><script>alert(document.cookie)</script></body></html>');
export const HTML_WITH_BOM = concat(hex('EF BB BF'), text('<html><script>alert(1)</script></html>'));
export const XML = text('<?xml version="1.0"?><root/>');
export const GIF = text('GIF89a\x01\x00\x01\x00\x00\x00\x00;');

export const EMPTY = new Uint8Array(0);
export const TRUNCATED_JPEG = hex('FF D8');
export const TRUNCATED_PNG = hex('89 50 4E 47 0D 0A');
export const TRUNCATED_PDF = text('%PD');
export const TRUNCATED_WEBP = text('RIFF\x1a\x00\x00\x00WEB');
export const TRUNCATED_ZIP = DOCX.slice(0, 30);
