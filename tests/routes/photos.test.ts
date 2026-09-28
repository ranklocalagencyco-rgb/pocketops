import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { jobPhotos } from '../../src/db/schema';
import { POST } from '../../src/pages/api/app/photos/index';
import { GET } from '../../src/pages/api/app/photos/[id]';
import * as bytes from '../helpers/bytes';
import { apiContext, db, seedBusiness, seedPhoto, uploadRequest } from '../helpers/fixtures';

type Biz = Awaited<ReturnType<typeof seedBusiness>>;
let a: Biz;
let b: Biz;

beforeEach(async () => {
  a = await seedBusiness('Business A');
  b = await seedBusiness('Business B');
});

const owner = (biz: Biz) => ({ tenantId: biz.tenantId, userId: biz.ownerId, userRole: 'owner' as const });

async function upload(biz: Biz, data: Uint8Array | string, filename: string, claimedType: string) {
  const request = uploadRequest(
    `https://app.test/api/app/photos?jobId=${biz.jobId}`,
    'photo',
    data,
    filename,
    claimedType,
  );
  return POST(apiContext(request, { session: owner(biz) }));
}

const photosFor = (jobId: string) => db().select().from(jobPhotos).where(eq(jobPhotos.jobId, jobId));

async function fetchPhoto(biz: Biz, id: string) {
  const request = new Request(`https://app.test/api/app/photos/${id}`);
  return GET(apiContext(request, { session: owner(biz), params: { id } }));
}

describe('photo upload', () => {
  it('stores a real JPEG and redirects back to the job', async () => {
    const res = await upload(a, bytes.JPEG, 'boiler.jpg', 'image/jpeg');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/dashboard/jobs/${a.jobId}`);

    const rows = await photosFor(a.jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0].contentType).toBe('image/jpeg');
    expect(rows[0].tenantId).toBe(a.tenantId);
    const object = await env.FILES.get(rows[0].r2Key);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes.JPEG);
    expect(object!.httpMetadata?.contentType).toBe('image/jpeg');
  });

  it.each([
    ['PNG', bytes.PNG, 'image/png'],
    ['WebP', bytes.WEBP, 'image/webp'],
    ['HEIC', bytes.HEIC, 'image/heic'],
    ['HEIF', bytes.HEIF, 'image/heif'],
  ])('accepts a %s photo and stores its real type', async (_label, data, expected) => {
    const res = await upload(a, data, 'site-photo', expected);
    expect(res.status).toBe(303);
    const rows = await photosFor(a.jobId);
    expect(rows.map((r) => r.contentType)).toEqual([expected]);
  });

  it('stores a PNG claimed as JPEG as PNG (the bytes decide, not the claim)', async () => {
    await upload(a, bytes.PNG, 'photo.jpg', 'image/jpeg');
    const rows = await photosFor(a.jobId);
    expect(rows.map((r) => r.contentType)).toEqual(['image/png']);
    const object = await env.FILES.head(rows[0].r2Key);
    expect(object!.httpMetadata?.contentType).toBe('image/png');
  });

  it('accepts an iPhone HEIC photo even when the browser sends no type', async () => {
    const res = await upload(a, bytes.HEIC, 'IMG_0001.HEIC', '');
    expect(res.status).toBe(303);
    expect((await photosFor(a.jobId)).map((r) => r.contentType)).toEqual(['image/heic']);
  });

  it.each([
    ['HTML named .jpg', bytes.HTML, 'evil.jpg', 'image/jpeg'],
    ['SVG with script', bytes.SVG, 'logo.svg', 'image/svg+xml'],
    ['SVG claimed as PNG', bytes.SVG_NO_PROLOG, 'logo.png', 'image/png'],
    ['XML claimed as an image', bytes.XML, 'data.png', 'image/png'],
    ['GIF (not an approved photo type)', bytes.GIF, 'anim.gif', 'image/gif'],
    ['AVIF (not an approved photo type)', bytes.AVIF, 'photo.avif', 'image/avif'],
    ['MP4 video', bytes.MP4, 'clip.mp4', 'image/jpeg'],
    ['PDF', bytes.PDF, 'scan.jpg', 'image/jpeg'],
    ['truncated JPEG', bytes.TRUNCATED_JPEG, 'broken.jpg', 'image/jpeg'],
    ['truncated PNG', bytes.TRUNCATED_PNG, 'broken.png', 'image/png'],
  ])('rejects %s and stores nothing', async (_label, data, filename, claimedType) => {
    const res = await upload(a, data, filename, claimedType);
    expect(res.status).toBe(415);
    expect(await res.text()).toMatch(/JPEG, PNG, WebP or HEIC/);
    expect(await photosFor(a.jobId)).toHaveLength(0);
    const listed = await env.FILES.list({ prefix: `${a.tenantId}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it('keeps the existing behaviour for a missing file (redirect, nothing stored)', async () => {
    const request = new Request(`https://app.test/api/app/photos?jobId=${a.jobId}`, {
      method: 'POST',
      body: new FormData(),
    });
    const res = await POST(apiContext(request, { session: owner(a) }));
    expect(res.status).toBe(303);
    expect(await photosFor(a.jobId)).toHaveLength(0);
  });

  it('keeps the 8MB limit', async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(bytes.JPEG.slice(0, 20));
    const res = await upload(a, big, 'huge.jpg', 'image/jpeg');
    expect(res.status).toBe(413);
    expect(await photosFor(a.jobId)).toHaveLength(0);
  });

  it("cannot upload to another business's job", async () => {
    const request = uploadRequest(
      `https://app.test/api/app/photos?jobId=${b.jobId}`,
      'photo',
      bytes.JPEG,
      'x.jpg',
      'image/jpeg',
    );
    const res = await POST(apiContext(request, { session: owner(a) }));
    expect(res.status).toBe(404);
    expect(await photosFor(b.jobId)).toHaveLength(0);
  });
});

describe('photo serving', () => {
  it('serves a photo inline with safe headers', async () => {
    const id = await seedPhoto(a.tenantId, a.jobId, bytes.JPEG, 'image/jpeg');
    const res = await fetchPhoto(a, id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline;/);
    expect(res.headers.get('Content-Security-Policy')).toMatch(/sandbox/);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.JPEG);
  });

  it('serves a legacy SVG photo as a download that cannot run', async () => {
    const id = await seedPhoto(a.tenantId, a.jobId, bytes.SVG, 'image/svg+xml');
    const res = await fetchPhoto(a, id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toMatch(/sandbox/);
    // Still downloadable — nothing is lost.
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.SVG);
  });

  it('never lets a mislabelled legacy file be sniffed into HTML', async () => {
    // Old code stored whatever type the browser claimed, so HTML may sit under image/jpeg.
    const id = await seedPhoto(a.tenantId, a.jobId, bytes.HTML, 'image/jpeg');
    const res = await fetchPhoto(a, id);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toMatch(/sandbox/);
  });

  it("returns 404 for another business's photo", async () => {
    const id = await seedPhoto(b.tenantId, b.jobId, bytes.JPEG, 'image/jpeg');
    const res = await fetchPhoto(a, id);
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown photo id', async () => {
    expect((await fetchPhoto(a, 'does-not-exist')).status).toBe(404);
  });
});
