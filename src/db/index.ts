/**
 * Tenant-scoped database access.
 *
 * Rules for every consumer of this module:
 *  1. Reads/updates/deletes: build WHERE clauses with `tenantWhere(...)` —
 *     it is impossible to forget the tenant_id predicate.
 *  2. Inserts: wrap values in `tenantValues(tenantId, values)` — it
 *     force-overwrites any client-supplied tenantId.
 *  3. Single-row fetches by unique key (e.g. clientToken): pass the result
 *     through `assertTenant(...)` when a tenant context exists.
 */
import { and, eq, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
export type Db = ReturnType<typeof createDb>;

/** Any table that participates in tenant isolation (all except `tenants`). */
export type TenantScopedTable = SQLiteTable & { tenantId: SQLiteColumn };

export class TenantIsolationError extends Error {
  constructor(message = 'Cross-tenant access blocked') {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

/**
 * Compose a WHERE clause that is always pinned to the tenant.
 *
 *   db.select().from(jobs).where(tenantWhere(jobs, tenantId, eq(jobs.status, 'lead')))
 */
export function tenantWhere<T extends TenantScopedTable>(
  table: T,
  tenantId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  if (!tenantId) throw new TenantIsolationError('Missing tenantId in query scope');
  const extras = conditions.filter((c): c is SQL => c !== undefined);
  const scoped = eq(table.tenantId, tenantId);
  return extras.length > 0 ? and(scoped, ...extras)! : scoped;
}

/**
 * Stamp insert values with the session tenant. Placed last in the spread so
 * a spoofed tenantId in the payload can never win.
 */
export function tenantValues<T extends Record<string, unknown>>(
  tenantId: string,
  values: T,
): T & { tenantId: string } {
  if (!tenantId) throw new TenantIsolationError('Missing tenantId for insert');
  return { ...values, tenantId };
}

/**
 * Runtime backstop for rows fetched by a global unique key (email, token).
 * Returns null for "not found" so callers can 404; throws on a genuine
 * cross-tenant hit so it is loudly visible in logs, never silently served.
 */
export function assertTenant<T extends { tenantId: string }>(
  row: T | undefined,
  tenantId: string,
): T | null {
  if (!row) return null;
  if (row.tenantId !== tenantId) throw new TenantIsolationError();
  return row;
}

export { schema };
