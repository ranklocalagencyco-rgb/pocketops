import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { tenantDocuments } from '../../src/db/schema';
import { POST } from '../../src/pages/api/app/docs/index';
import { GET as getInternal } from '../../src/pages/api/app/docs/[id]';
import { GET as getShared } from '../../src/pages/docs/[token]';
import * as bytes from '../helpers/bytes';
import { apiContext, db, seedBusiness, seedDocument, uploadRequest } from '../helpers/fixtures';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

type Biz = Awaited<ReturnType<typeof seedBusiness>>;
let a: Biz;
let b: Biz;

beforeEach(async () => {
  a = await seedBusiness('Business A');
  b = await seedBusiness('Business B');
});

const session = (biz: Biz, role: 'owner' | 'technician' = 'owner') => ({
  tenantId: biz.tenantId,
  userId: role === 'owner' ? biz.ownerId : biz.techId,
  userRole: role,
});

async function upload(biz: Biz, data: Uint8Array | string, filename: string, claimedType: string) {
  const request = uploadRequest('https://app.test/api/app/docs', 'file', data, filename, claimedType, {
    name: '',
    showOnPortal: '1',
  });
  return POST(apiContext(request, { session: session(biz) }));
}

const docsFor = (tenantId: string) =>
  db().select().from(tenantDocuments).where(eq(tenantDocuments.tenantId, tenantId));

const fetchInternal = (biz: Biz, id: string) =>
  getInternal(
    apiContext(new Request(`https://app.test/api/app/docs/${id}`), { session: session(biz), params: { id } }),
  );

const fetchShared = (token: string) =>
  getShared(apiContext(new Request(`https://app.test/docs/${token}`), { params: { token } }));

describe('document upload', () => {
  it.each([
    ['PDF', bytes.PDF, 'insurance.pdf', 'application/pdf', 'application/pdf'],
    ['JPEG', bytes.JPEG, 'licence.jpg', 'image/jpeg', 'image/jpeg'],
    ['PNG', bytes.PNG, 'badge.png', 'image/png', 'image/png'],
    ['DOCX', bytes.DOCX, 'terms.docx', DOCX_TYPE, DOCX_TYPE],
    ['XLSX', bytes.XLSX, 'rates.xlsx', XLSX_TYPE, XLSX_TYPE],
    ['PPTX', bytes.PPTX, 'intro.pptx', PPTX_TYPE, PPTX_TYPE],
  ])('stores a %s with its real type', async (_label, data, filename, claimed, expected) => {
    const res = await upload(a, data, filename, claimed);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/dashboard/settings/documents');
    const rows = await docsFor(a.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0].contentType).toBe(expected);
    expect(rows[0].name).toBe(filename);
    expect(rows[0].sizeBytes).toBe(data.length);
    const object = await env.FILES.get(rows[0].r2Key);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(data);
    expect(object!.httpMetadata?.contentType).toBe(expected);
  });

  it('stores a PNG claimed as PDF as PNG', async () => {
    await upload(a, bytes.PNG, 'scan.pdf', 'application/pdf');
    expect((await docsFor(a.tenantId)).map((r) => r.contentType)).toEqual(['image/png']);
  });

  it('accepts a Word document the browser labelled as a generic download', async () => {
    const res = await upload(a, bytes.DOCX, 'terms.docx', 'application/octet-stream');
    expect(res.status).toBe(303);
    expect((await docsFor(a.tenantId)).map((r) => r.contentType)).toEqual([DOCX_TYPE]);
  });

  it.each([
    ['SVG with script', bytes.SVG, 'logo.svg', 'image/svg+xml'],
    ['HTML named .pdf', bytes.HTML, 'insurance.pdf', 'application/pdf'],
    ['HTML named .jpg', bytes.HTML, 'licence.jpg', 'image/jpeg'],
    ['HTML with a byte-order mark', bytes.HTML_WITH_BOM, 'page.docx', DOCX_TYPE],
    ['XML', bytes.XML, 'data.xml', 'application/xml'],
    ['macro-enabled Word (.docm)', bytes.DOCM, 'terms.docx', DOCX_TYPE],
    ['plain ZIP archive', bytes.PLAIN_ZIP, 'files.docx', DOCX_TYPE],
    ['MP4 video', bytes.MP4, 'clip.mp4', 'video/mp4'],
    ['truncated PDF', bytes.TRUNCATED_PDF, 'broken.pdf', 'application/pdf'],
    ['truncated Word file', bytes.TRUNCATED_ZIP, 'broken.docx', DOCX_TYPE],
  ])('rejects %s and stores nothing', async (_label, data, filename, claimedType) => {
    const res = await upload(a, data, filename, claimedType);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/dashboard/settings/documents?error=type');
    expect(await docsFor(a.tenantId)).toHaveLength(0);
    const listed = await env.FILES.list({ prefix: `${a.tenantId}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it('keeps the owner/admin-only rule', async () => {
    const request = uploadRequest('https://app.test/api/app/docs', 'file', bytes.PDF, 'a.pdf', 'application/pdf');
    const res = await POST(apiContext(request, { session: session(a, 'technician') }));
    expect(res.status).toBe(403);
    expect(await docsFor(a.tenantId)).toHaveLength(0);
  });

  it('keeps the 10MB limit', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(bytes.PDF);
    const res = await upload(a, big, 'huge.pdf', 'application/pdf');
    expect(res.headers.get('Location')).toBe('/dashboard/settings/documents?error=size');
    expect(await docsFor(a.tenantId)).toHaveLength(0);
  });
});

describe('document serving', () => {
  it('serves a PDF for viewing with nosniff and private caching', async () => {
    const doc = await seedDocument(a.tenantId, bytes.PDF, 'application/pdf', 'Public liability insurance');
    for (const res of [await fetchInternal(a, doc.id), await fetchShared(doc.shareToken)]) {
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Disposition')).toMatch(
        /^inline; filename="Public liability insurance\.pdf"; filename\*=UTF-8''Public%20liability%20insurance\.pdf$/,
      );
      expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.PDF);
    }
  });

  it('serves a Word document as a download', async () => {
    const doc = await seedDocument(a.tenantId, bytes.DOCX, DOCX_TYPE, 'Terms');
    const res = await fetchShared(doc.shareToken);
    expect(res.headers.get('Content-Type')).toBe(DOCX_TYPE);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="Terms\.docx"/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it.each([
    ['share link', 'shared'],
    ['signed-in view', 'internal'],
  ])('serves a legacy SVG document as a harmless download (%s)', async (_label, route) => {
    const doc = await seedDocument(a.tenantId, bytes.SVG, 'image/svg+xml', 'Company logo');
    const res = route === 'shared' ? await fetchShared(doc.shareToken) : await fetchInternal(a, doc.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toMatch(/sandbox/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.SVG);
  });

  it('serves a legacy HTML document as a harmless download', async () => {
    const doc = await seedDocument(a.tenantId, bytes.HTML, 'text/html', 'Brochure');
    const res = await fetchShared(doc.shareToken);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('cannot be tricked into header injection by a document name', async () => {
    const doc = await seedDocument(a.tenantId, bytes.PDF, 'application/pdf', 'Cert"\r\nSet-Cookie: x=1; Bülow £');
    const res = await fetchShared(doc.shareToken);
    const disposition = res.headers.get('Content-Disposition')!;
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).toMatch(/^inline; filename="[^"\\]*"; filename\*=UTF-8''[A-Za-z0-9%._~!-]+$/);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it("returns 404 for another business's document", async () => {
    const doc = await seedDocument(b.tenantId, bytes.PDF, 'application/pdf');
    expect((await fetchInternal(a, doc.id)).status).toBe(404);
  });

  it('returns 404 for a short or unknown share token', async () => {
    expect((await fetchShared('short')).status).toBe(404);
    expect((await fetchShared('x'.repeat(24))).status).toBe(404);
  });
});
