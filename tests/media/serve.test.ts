import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { fileHeaders, fileResponse } from '../../src/media/serve';
import { DOCX_TYPE, PPTX_TYPE, XLSX_TYPE } from '../../src/media/sniff';
import * as bytes from '../helpers/bytes';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

function expectProtected(h: Headers) {
  expect(h.get('X-Content-Type-Options')).toBe('nosniff');
  expect(h.get('Content-Security-Policy')).toBe(CSP);
  expect(h.get('Cache-Control')).toBe('private, max-age=3600');
}

describe('fileHeaders: safe types display in the browser', () => {
  it.each([
    ['image/jpeg', 'photo.jpg'],
    ['image/png', 'photo.png'],
    ['image/webp', 'photo.webp'],
    ['image/heic', 'photo.heic'],
    ['image/heif', 'photo.heif'],
    ['application/pdf', 'file.pdf'],
  ])('%s is served inline with its real type', (type, name) => {
    const h = fileHeaders(type, name);
    expect(h.get('Content-Type')).toBe(type);
    expect(h.get('Content-Disposition')).toBe(`inline; filename="${name}"; filename*=UTF-8''${name}`);
    expectProtected(h);
  });

  it.each(['image/gif', 'image/avif', 'image/bmp'])(
    'legacy raster %s stays viewable (no longer uploadable, but older rows may exist)',
    (type) => {
      const h = fileHeaders(type, 'old');
      expect(h.get('Content-Type')).toBe(type);
      expect(h.get('Content-Disposition')).toMatch(/^inline;/);
      expectProtected(h);
    },
  );

  it.each([
    ['image/jpg', 'image/jpeg'],
    ['image/pjpeg', 'image/jpeg'],
    ['image/x-png', 'image/png'],
    ['IMAGE/PNG; charset=binary', 'image/png'],
    [' application/PDF ', 'application/pdf'],
  ])('normalises stored type %j to %s', (stored, served) => {
    expect(fileHeaders(stored, 'x').get('Content-Type')).toBe(served);
  });
});

describe('fileHeaders: office files download', () => {
  it.each([
    [DOCX_TYPE, 'Terms', 'Terms.docx'],
    [XLSX_TYPE, 'Rates', 'Rates.xlsx'],
    [PPTX_TYPE, 'Pitch', 'Pitch.pptx'],
    ['application/msword', 'Old terms', 'Old terms.doc'],
  ])('%s is an attachment with its real type', (type, name, expectedName) => {
    const h = fileHeaders(type, name);
    expect(h.get('Content-Type')).toBe(type);
    expect(h.get('Content-Disposition')).toMatch(new RegExp(`^attachment; filename="${expectedName}";`));
    expectProtected(h);
  });
});

describe('fileHeaders: unknown or unsafe stored types never render', () => {
  it.each([
    'image/svg+xml',
    'text/html',
    'application/xhtml+xml',
    'text/xml',
    'application/xml',
    'text/plain',
    'application/javascript',
    'application/octet-stream',
    'video/mp4',
    '',
    'garbage',
  ])('%j becomes an opaque download', (type) => {
    const h = fileHeaders(type, 'logo.svg');
    expect(h.get('Content-Type')).toBe('application/octet-stream');
    expect(h.get('Content-Disposition')).toBe(`attachment; filename="logo.svg"; filename*=UTF-8''logo.svg`);
    expectProtected(h);
  });
});

describe('fileHeaders: filenames', () => {
  it('adds the extension for the real type when missing', () => {
    expect(fileHeaders('image/png', 'photo-abc').get('Content-Disposition')).toMatch(/filename="photo-abc\.png"/);
    expect(fileHeaders('application/pdf', 'Insurance').get('Content-Disposition')).toMatch(/filename="Insurance\.pdf"/);
  });

  it('keeps an existing matching extension, whatever its case', () => {
    expect(fileHeaders('image/jpeg', 'Van.JPEG').get('Content-Disposition')).toMatch(/filename="Van\.JPEG"/);
    expect(fileHeaders('image/jpeg', 'van.jpg').get('Content-Disposition')).toMatch(/filename="van\.jpg"/);
  });

  it('appends the real extension when the name claims a different type', () => {
    expect(fileHeaders('image/png', 'invoice.pdf').get('Content-Disposition')).toMatch(/filename="invoice\.pdf\.png"/);
  });

  it('leaves unknown-type names alone', () => {
    expect(fileHeaders('text/html', 'page').get('Content-Disposition')).toMatch(/filename="page"/);
  });

  it('keeps spaces and encodes the UTF-8 name', () => {
    expect(fileHeaders('application/pdf', 'Public liability insurance').get('Content-Disposition')).toBe(
      `inline; filename="Public liability insurance.pdf"; filename*=UTF-8''Public%20liability%20insurance.pdf`,
    );
    expect(fileHeaders('application/pdf', 'Bülow £ cert').get('Content-Disposition')).toBe(
      `inline; filename="Blow  cert.pdf"; filename*=UTF-8''B%C3%BClow%20%C2%A3%20cert.pdf`,
    );
  });

  it('cannot inject headers or break out of the quoted name', () => {
    const value = fileHeaders('application/pdf', 'a"b\\c\r\nSet-Cookie: x=1\u0000').get('Content-Disposition')!;
    expect(value).not.toMatch(/[\r\n\0]/);
    expect(value).toMatch(/^inline; filename="abcSet-Cookie: x=1\.pdf"; filename\*=UTF-8''[A-Za-z0-9%._~!-]+$/);
  });

  it("percent-encodes the characters encodeURIComponent leaves alone: ' ( ) *", () => {
    expect(fileHeaders('application/pdf', "O'Brien (final)*").get('Content-Disposition')).toMatch(
      /filename\*=UTF-8''O%27Brien%20%28final%29%2A\.pdf$/,
    );
  });

  it('drops lone surrogates rather than throwing', () => {
    expect(() => fileHeaders('application/pdf', 'bad\ud800name')).not.toThrow();
    expect(fileHeaders('application/pdf', 'bad\ud800name').get('Content-Disposition')).toMatch(/filename="badname\.pdf"/);
  });

  it('falls back to "download" when nothing printable is left', () => {
    expect(fileHeaders('application/pdf', '').get('Content-Disposition')).toMatch(/^inline; filename="download\.pdf";/);
    expect(fileHeaders('image/png', '照片').get('Content-Disposition')).toBe(
      `inline; filename="download.png"; filename*=UTF-8''%E7%85%A7%E7%89%87.png`,
    );
    expect(fileHeaders('text/html', '\r\n').get('Content-Disposition')).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    );
  });
});

describe('fileResponse', () => {
  it('streams the stored bytes with the protective headers', async () => {
    await env.FILES.put('serve-test/object', bytes.PNG);
    const object = await env.FILES.get('serve-test/object');
    const res = fileResponse(object!, 'image/png', 'photo-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expectProtected(res.headers);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.PNG);
  });
});
