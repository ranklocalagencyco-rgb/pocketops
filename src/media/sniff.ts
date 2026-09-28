/**
 * Identify an uploaded file from its bytes alone. The file name, the browser's
 * Content-Type and anything else the client claims are never trusted.
 *
 * Only the formats below are recognised. Everything else — SVG, HTML, XML,
 * text, video, audio, other archives, truncated or empty input — returns null.
 */

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export type SniffedType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif'
  | 'application/pdf'
  | typeof DOCX_TYPE
  | typeof XLSX_TYPE
  | typeof PPTX_TYPE;

export const PHOTO_TYPES: ReadonlySet<SniffedType> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const DOCUMENT_TYPES: ReadonlySet<SniffedType> = new Set([
  ...PHOTO_TYPES,
  'application/pdf',
  DOCX_TYPE,
  XLSX_TYPE,
  PPTX_TYPE,
]);

export function sniffType(bytes: Uint8Array): SniffedType | null {
  return sniffJpeg(bytes) ?? sniffPng(bytes) ?? sniffWebp(bytes) ?? sniffHeif(bytes) ?? sniffPdf(bytes) ?? sniffOoxml(bytes);
}

const ascii = (b: Uint8Array, start: number, length: number) =>
  start + length <= b.length ? String.fromCharCode(...b.subarray(start, start + length)) : '';
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function sniffJpeg(b: Uint8Array): SniffedType | null {
  // SOI marker, then the first segment's marker (APPn, DQT, SOF, …).
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] >= 0xc0 ? 'image/jpeg' : null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sniffPng(b: Uint8Array): SniffedType | null {
  // Signature, then the mandatory IHDR chunk first.
  return b.length >= 16 && PNG_SIGNATURE.every((v, i) => b[i] === v) && ascii(b, 12, 4) === 'IHDR'
    ? 'image/png'
    : null;
}

function sniffWebp(b: Uint8Array): SniffedType | null {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  return chunk === 'VP8 ' || chunk === 'VP8L' || chunk === 'VP8X' ? 'image/webp' : null;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** HEIC/HEIF photos (ISO-BMFF). MP4/MOV video and AVIF share the container and are rejected. */
function sniffHeif(b: Uint8Array): SniffedType | null {
  if (b.length < 16 || ascii(b, 4, 4) !== 'ftyp') return null;
  const boxSize = u32be(b, 0);
  if (boxSize < 16 || boxSize > b.length) return null;
  const brands = [ascii(b, 8, 4)];
  for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(ascii(b, i, 4));
  if (brands.some((x) => AVIF_BRANDS.has(x))) return null;
  if (brands.some((x) => HEIC_BRANDS.has(x))) return 'image/heic';
  if (brands.some((x) => HEIF_BRANDS.has(x))) return 'image/heif';
  return null;
}

function sniffPdf(b: Uint8Array): SniffedType | null {
  return ascii(b, 0, 5) === '%PDF-' ? 'application/pdf' : null;
}

const EOCD_SIZE = 22;
const MAX_ZIP_COMMENT = 0xffff;

/**
 * Word, Excel and PowerPoint (OOXML) files are ZIP archives. Read the ZIP's
 * central directory and require the parts that define each format. A plain ZIP
 * or a macro-enabled file (it carries vbaProject.bin) is rejected.
 */
function sniffOoxml(b: Uint8Array): SniffedType | null {
  if (b.length < EOCD_SIZE + 30 || u32le(b, 0) !== 0x04034b50) return null;

  // End-of-central-directory record: searched backwards past an optional comment.
  let eocd = -1;
  for (let i = b.length - EOCD_SIZE; i >= Math.max(0, b.length - EOCD_SIZE - MAX_ZIP_COMMENT); i--) {
    if (u32le(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entries = u16le(b, eocd + 10);
  const dirSize = u32le(b, eocd + 12);
  const dirOffset = u32le(b, eocd + 16);
  // ZIP64 markers — never needed for files within our upload limits.
  if (entries === 0xffff || dirOffset === 0xffffffff || dirOffset + dirSize > eocd) return null;

  const names = new Set<string>();
  const decoder = new TextDecoder();
  let p = dirOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > eocd || u32le(b, p) !== 0x02014b50) return null;
    const nameLength = u16le(b, p + 28);
    const extraLength = u16le(b, p + 30);
    const commentLength = u16le(b, p + 32);
    if (p + 46 + nameLength > eocd) return null;
    // OOXML part names are case-insensitive.
    names.add(decoder.decode(b.subarray(p + 46, p + 46 + nameLength)).toLowerCase());
    p += 46 + nameLength + extraLength + commentLength;
  }

  if (!names.has('[content_types].xml')) return null;
  for (const name of names) if (name.endsWith('vbaproject.bin')) return null;
  if (names.has('word/document.xml')) return DOCX_TYPE;
  if (names.has('xl/workbook.xml')) return XLSX_TYPE;
  if (names.has('ppt/presentation.xml')) return PPTX_TYPE;
  return null;
}
