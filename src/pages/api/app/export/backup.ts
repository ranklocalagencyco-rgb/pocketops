/**
 * Full account backup: /api/app/export/backup → pocketops-backup-YYYY-MM-DD.zip
 * All six CSVs + document library + job photos (newest first, size-capped),
 * with a manifest listing counts and anything skipped. Owner/admin only.
 *
 * Every R2 read is best-effort — one missing object never kills the backup
 * (same pattern as the logo embed in the PDF routes).
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { desc, eq } from 'drizzle-orm';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { createDb, tenantWhere } from '../../../../db';
import { jobPhotos, tenantDocuments, tenants } from '../../../../db/schema';
import { csvText, type CsvRows } from '../../../../lib/csv';
import {
  exportCustomers,
  exportExpenses,
  exportInvoices,
  exportJobs,
  exportPriceBook,
  exportTimeEntries,
} from '../../../../lib/export';
import { canSeeFinancials } from '../../../../lib/masking';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // per R2 object
const MAX_TOTAL_BYTES = 60 * 1024 * 1024; // Workers memory guardrail

const EXT_BY_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const sanitize = (name: string): string => name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 80);

export const GET: APIRoute = async ({ locals }) => {
  if (!canSeeFinancials(locals.userRole!)) return new Response('Forbidden', { status: 403 });
  const tenantId = locals.tenantId!;
  const db = createDb(env.DB);
  const [tenant] = await db
    .select({ name: tenants.name, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const tz = tenant?.timezone ?? 'Europe/London';

  const files: Zippable = {};
  const manifest: string[] = [
    `Pocket Ops backup — ${tenant?.name ?? tenantId}`,
    `Generated ${new Date().toISOString()}`,
    '',
  ];

  const addCsv = (name: string, rows: CsvRows) => {
    files[name] = [strToU8(csvText(rows)), { level: 6 }];
    manifest.push(`${name}: ${rows.length - 1} rows`);
  };
  addCsv('customers.csv', await exportCustomers(db, tenantId, tz));
  addCsv('jobs.csv', await exportJobs(db, tenantId, tz));
  addCsv('invoices.csv', await exportInvoices(db, tenantId, tz));
  addCsv('expenses.csv', await exportExpenses(db, tenantId, tz));
  addCsv('time-entries.csv', await exportTimeEntries(db, tenantId, tz));
  addCsv('pricebook.csv', await exportPriceBook(db, tenantId));

  let totalBytes = 0;
  const usedNames = new Set<string>();

  // Document library — small, always included (per-file cap only)
  const docs = await db.select().from(tenantDocuments).where(tenantWhere(tenantDocuments, tenantId));
  for (const doc of docs) {
    try {
      if (doc.sizeBytes > MAX_FILE_BYTES) {
        manifest.push(`SKIPPED documents/${sanitize(doc.name)} — over 10MB limit`);
        continue;
      }
      const obj = await env.FILES.get(doc.r2Key);
      if (!obj) {
        manifest.push(`SKIPPED documents/${sanitize(doc.name)} — missing from storage`);
        continue;
      }
      const bytes = new Uint8Array(await obj.arrayBuffer());
      let name = sanitize(doc.name);
      const ext = EXT_BY_TYPE[doc.contentType] ?? '';
      if (ext && !name.toLowerCase().endsWith(ext)) name += ext;
      let unique = name;
      for (let n = 2; usedNames.has(unique); n++) unique = name.replace(/(\.[^.]*)?$/, `-${n}$1`);
      usedNames.add(unique);
      files[`documents/${unique}`] = [bytes, { level: 0 }]; // PDFs/images don't recompress
      totalBytes += bytes.length;
    } catch {
      manifest.push(`SKIPPED documents/${sanitize(doc.name)} — read failed`);
    }
  }

  // Job photos — newest first until the total cap
  const photos = await db
    .select()
    .from(jobPhotos)
    .where(tenantWhere(jobPhotos, tenantId))
    .orderBy(desc(jobPhotos.createdAt));
  let photosIncluded = 0;
  let photosOmitted = 0;
  for (const photo of photos) {
    if (totalBytes >= MAX_TOTAL_BYTES) {
      photosOmitted++;
      continue;
    }
    try {
      const obj = await env.FILES.get(photo.r2Key);
      if (!obj) continue;
      const bytes = new Uint8Array(await obj.arrayBuffer());
      if (bytes.length > MAX_FILE_BYTES || totalBytes + bytes.length > MAX_TOTAL_BYTES) {
        photosOmitted++;
        continue;
      }
      const ext = EXT_BY_TYPE[photo.contentType] ?? '.jpg';
      files[`photos/${photo.jobId}/${photo.id}${ext}`] = [bytes, { level: 0 }];
      totalBytes += bytes.length;
      photosIncluded++;
    } catch {
      photosOmitted++;
    }
  }
  manifest.push('', `documents: ${docs.length} in library`, `photos: ${photosIncluded} included`);
  if (photosOmitted > 0) manifest.push(`photos omitted (size cap or read failure): ${photosOmitted}`);

  files['manifest.txt'] = [strToU8(manifest.join('\n') + '\n'), { level: 6 }];

  const zipped = zipSync(files);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(zipped, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="pocketops-backup-${date}.zip"`,
    },
  });
};
