/**
 * Shared test fixtures: seed rows (always via tenantValues, like the app) and a
 * minimal APIContext so exported route handlers can be called directly.
 */
import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';
import { createDb, tenantValues } from '../../src/db';
import {
  customers,
  jobPhotos,
  jobs,
  tenantDocuments,
  tenants,
  users,
  type UserRole,
} from '../../src/db/schema';
import { newClientToken, newId } from '../../src/lib/ids';

export const db = () => createDb(env.DB);

export async function seedTenant(name = 'Test Trades Ltd'): Promise<string> {
  const id = newId();
  // Explicit regional values: the migrated DB defaults (usd / America/New_York /
  // 0% tax) differ from schema.ts, exactly as signup has to handle in production.
  await db()
    .insert(tenants)
    .values({
      id,
      name,
      slug: `t-${id.toLowerCase()}`,
      currency: 'gbp',
      timezone: 'Europe/London',
      taxRateBps: 2000,
    });
  return id;
}

export async function seedUser(tenantId: string, role: UserRole = 'owner'): Promise<string> {
  const id = newId();
  await db()
    .insert(users)
    .values(
      tenantValues(tenantId, {
        id,
        email: `${id.toLowerCase()}@example.test`,
        passwordHash: 'not-a-real-hash',
        name: `Test ${role}`,
        role,
      }),
    );
  return id;
}

export async function seedCustomer(tenantId: string): Promise<string> {
  const id = newId();
  await db()
    .insert(customers)
    .values(tenantValues(tenantId, { id, name: 'Test Customer' }));
  return id;
}

export async function seedJob(
  tenantId: string,
  customerId: string,
  assignedUserId: string | null = null,
): Promise<string> {
  const id = newId();
  await db()
    .insert(jobs)
    .values(
      tenantValues(tenantId, {
        id,
        customerId,
        assignedUserId,
        title: 'Test job',
        clientToken: newClientToken(),
      }),
    );
  return id;
}

/** A complete business: tenant, owner, technician, customer and one job. */
export async function seedBusiness(name?: string) {
  const tenantId = await seedTenant(name);
  const ownerId = await seedUser(tenantId, 'owner');
  const techId = await seedUser(tenantId, 'technician');
  const customerId = await seedCustomer(tenantId);
  const jobId = await seedJob(tenantId, customerId);
  return { tenantId, ownerId, techId, customerId, jobId };
}

/** Put bytes in R2 and a job_photos row pointing at them (simulates legacy data). */
export async function seedPhoto(
  tenantId: string,
  jobId: string,
  bytes: Uint8Array | string,
  contentType: string,
): Promise<string> {
  const id = newId();
  const r2Key = `${tenantId}/${jobId}/${id}`;
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType } });
  await db()
    .insert(jobPhotos)
    .values(tenantValues(tenantId, { id, jobId, r2Key, contentType }));
  return id;
}

/** Put bytes in R2 and a tenant_documents row pointing at them (simulates legacy data). */
export async function seedDocument(
  tenantId: string,
  bytes: Uint8Array | string,
  contentType: string,
  name = 'Document',
): Promise<{ id: string; shareToken: string }> {
  const id = newId();
  const shareToken = newClientToken();
  const r2Key = `${tenantId}/docs/${id}`;
  const size = typeof bytes === 'string' ? new TextEncoder().encode(bytes).length : bytes.length;
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType } });
  await db()
    .insert(tenantDocuments)
    .values(
      tenantValues(tenantId, { id, name, r2Key, contentType, sizeBytes: size, shareToken }),
    );
  return { id, shareToken };
}

type Session = { tenantId: string | null; userId: string | null; userRole: UserRole | null };

/**
 * The parts of Astro's APIContext our file routes use. Auth is normally set by
 * src/middleware.ts; here the test supplies it directly.
 */
export function apiContext(
  request: Request,
  opts: { session?: Session; params?: Record<string, string> } = {},
): APIContext {
  const session = opts.session ?? { tenantId: null, userId: null, userRole: null };
  return {
    request,
    url: new URL(request.url),
    params: opts.params ?? {},
    locals: { ...session },
    redirect: (path: string, status = 302) =>
      new Response(null, { status, headers: { Location: path } }),
  } as unknown as APIContext;
}

/** A multipart POST with one file field (the browser-claimed type is `claimedType`). */
export function uploadRequest(
  url: string,
  field: string,
  bytes: Uint8Array | string,
  filename: string,
  claimedType: string,
  extra: Record<string, string> = {},
): Request {
  const form = new FormData();
  form.append(field, new File([bytes as BlobPart], filename, { type: claimedType }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new Request(url, { method: 'POST', body: form });
}
