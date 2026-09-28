import { describe, expect, it } from 'vitest';
import { DOCUMENT_TYPES, DOCX_TYPE, PHOTO_TYPES, PPTX_TYPE, XLSX_TYPE, sniffType } from '../../src/media/sniff';
import * as bytes from '../helpers/bytes';

describe('sniffType recognises approved formats from their bytes', () => {
  it.each([
    ['JPEG', bytes.JPEG, 'image/jpeg'],
    ['PNG', bytes.PNG, 'image/png'],
    ['WebP', bytes.WEBP, 'image/webp'],
    ['HEIC (iPhone)', bytes.HEIC, 'image/heic'],
    ['HEIF', bytes.HEIF, 'image/heif'],
    ['PDF', bytes.PDF, 'application/pdf'],
    ['Word .docx', bytes.DOCX, DOCX_TYPE],
    ['Excel .xlsx', bytes.XLSX, XLSX_TYPE],
    ['PowerPoint .pptx', bytes.PPTX, PPTX_TYPE],
  ])('%s', (_name, data, expected) => {
    expect(sniffType(data)).toBe(expected);
  });
});

describe('sniffType rejects everything else', () => {
  it.each([
    ['SVG with script', bytes.SVG],
    ['SVG without XML prolog', bytes.SVG_NO_PROLOG],
    ['HTML', bytes.HTML],
    ['HTML with a byte-order mark', bytes.HTML_WITH_BOM],
    ['XML', bytes.XML],
    ['GIF', bytes.GIF],
    ['AVIF', bytes.AVIF],
    ['MP4 video', bytes.MP4],
    ['QuickTime video', bytes.MOV],
    ['macro-enabled Word .docm', bytes.DOCM],
    ['plain ZIP archive', bytes.PLAIN_ZIP],
    ['legacy Word .doc', bytes.LEGACY_DOC],
    ['empty file', bytes.EMPTY],
    ['truncated JPEG', bytes.TRUNCATED_JPEG],
    ['truncated PNG', bytes.TRUNCATED_PNG],
    ['truncated PDF', bytes.TRUNCATED_PDF],
    ['truncated WebP', bytes.TRUNCATED_WEBP],
    ['truncated ZIP', bytes.TRUNCATED_ZIP],
  ])('%s', (_name, data) => {
    expect(sniffType(data)).toBeNull();
  });

  it('ignores a valid signature that appears after leading bytes', () => {
    const padded = new Uint8Array(bytes.PNG.length + 1);
    padded.set(bytes.PNG, 1);
    expect(sniffType(padded)).toBeNull();
  });

  it('does not read past a ZIP central directory that claims more entries than exist', () => {
    const broken = bytes.DOCX.slice();
    const eocd = broken.length - 22;
    broken[eocd + 10] = 0x50; // entry count far beyond the real directory
    expect(sniffType(broken)).toBeNull();
  });
});

describe('allowed type sets', () => {
  it('photos accept images only', () => {
    expect([...PHOTO_TYPES].sort()).toEqual(['image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp']);
  });

  it('documents accept photos, PDF and Word/Excel/PowerPoint', () => {
    expect([...DOCUMENT_TYPES].sort()).toEqual(
      [...PHOTO_TYPES, 'application/pdf', DOCX_TYPE, XLSX_TYPE, PPTX_TYPE].sort(),
    );
  });
});
