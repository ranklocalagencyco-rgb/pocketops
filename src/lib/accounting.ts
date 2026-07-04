/**
 * Two-Way Financial Sync Matrix (Module 9) — QuickBooks Online & Xero.
 * OAuth2 authorization-code flow + best-effort invoice push. All calls are
 * plain fetch (isolate-safe). Failures land in ledger_sync_records.error,
 * never thrown into the request path.
 */
import { eq } from 'drizzle-orm';
import { tenantWhere, type Db } from '../db';
import {
  accountingConnections,
  customers,
  jobLineItems,
  jobs,
  ledgerSyncRecords,
} from '../db/schema';
import { newId } from './ids';

export type Provider = 'quickbooks' | 'xero';

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
  clientId: (env: Env) => string | undefined;
  clientSecret: (env: Env) => string | undefined;
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  quickbooks: {
    authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scopes: 'com.intuit.quickbooks.accounting',
    clientId: (env) => env.QBO_CLIENT_ID,
    clientSecret: (env) => env.QBO_CLIENT_SECRET,
  },
  xero: {
    authorizeUrl: 'https://login.xero.com/identity/connect/authorize',
    tokenUrl: 'https://identity.xero.com/connect/token',
    scopes: 'openid accounting.transactions accounting.contacts offline_access',
    clientId: (env) => env.XERO_CLIENT_ID,
    clientSecret: (env) => env.XERO_CLIENT_SECRET,
  },
};

export function isProvider(value: string): value is Provider {
  return value === 'quickbooks' || value === 'xero';
}

export function providerConfigured(provider: Provider, env: Env): boolean {
  const cfg = PROVIDERS[provider];
  return Boolean(cfg.clientId(env) && cfg.clientSecret(env));
}

export function buildAuthorizeUrl(
  provider: Provider,
  env: Env,
  redirectUri: string,
  state: string,
): string {
  const cfg = PROVIDERS[provider];
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set('client_id', cfg.clientId(env) ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scopes);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function exchangeCode(
  provider: Provider,
  env: Env,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const cfg = PROVIDERS[provider];
  const basic = btoa(`${cfg.clientId(env)}:${cfg.clientSecret(env)}`);
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`${provider} token exchange failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(
  provider: Provider,
  env: Env,
  refreshToken: string,
): Promise<TokenResponse> {
  const cfg = PROVIDERS[provider];
  const basic = btoa(`${cfg.clientId(env)}:${cfg.clientSecret(env)}`);
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`${provider} token refresh failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

/** Xero's post-auth "which org did they connect" lookup. */
export async function fetchXeroTenantId(accessToken: string): Promise<string | null> {
  const res = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const conns = (await res.json()) as { tenantId: string }[];
  return conns[0]?.tenantId ?? null;
}

type Connection = typeof accountingConnections.$inferSelect;

async function freshConnection(db: Db, env: Env, conn: Connection): Promise<Connection> {
  const expiresSoon =
    !conn.tokenExpiresAt || conn.tokenExpiresAt.getTime() < Date.now() + 60_000;
  if (!expiresSoon) return conn;
  const tokens = await refreshAccessToken(conn.provider, env, conn.refreshToken);
  const updated = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? conn.refreshToken,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    updatedAt: new Date(),
  };
  await db
    .update(accountingConnections)
    .set(updated)
    .where(tenantWhere(accountingConnections, conn.tenantId, eq(accountingConnections.id, conn.id)));
  return { ...conn, ...updated };
}

/**
 * Push a paid invoice into the connected ledger. Best-effort: one sync
 * record per connection, status synced|error, never throws.
 */
export async function syncPaidJob(db: Db, env: Env, tenantId: string, jobId: string): Promise<void> {
  const conns = await db
    .select()
    .from(accountingConnections)
    .where(tenantWhere(accountingConnections, tenantId, eq(accountingConnections.status, 'active')));
  if (conns.length === 0) return;

  const [job] = await db
    .select()
    .from(jobs)
    .where(tenantWhere(jobs, tenantId, eq(jobs.id, jobId)))
    .limit(1);
  if (!job) return;
  const [customer] = await db
    .select()
    .from(customers)
    .where(tenantWhere(customers, tenantId, eq(customers.id, job.customerId)))
    .limit(1);
  const items = await db
    .select()
    .from(jobLineItems)
    .where(tenantWhere(jobLineItems, tenantId, eq(jobLineItems.jobId, jobId)));

  for (const rawConn of conns) {
    const recordId = newId();
    await db.insert(ledgerSyncRecords).values({
      id: recordId,
      tenantId,
      connectionId: rawConn.id,
      jobId,
      entity: 'invoice',
      status: 'pending',
    });
    try {
      const conn = await freshConnection(db, env, rawConn);
      const externalId =
        conn.provider === 'quickbooks'
          ? await pushQboInvoice(env, conn, job, customer?.name ?? 'Customer', items)
          : await pushXeroInvoice(conn, job, customer?.name ?? 'Customer', items);
      await db
        .update(ledgerSyncRecords)
        .set({ status: 'synced', externalId, syncedAt: new Date() })
        .where(tenantWhere(ledgerSyncRecords, tenantId, eq(ledgerSyncRecords.id, recordId)));
    } catch (err) {
      await db
        .update(ledgerSyncRecords)
        .set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
        .where(tenantWhere(ledgerSyncRecords, tenantId, eq(ledgerSyncRecords.id, recordId)));
    }
  }
}

type Job = typeof jobs.$inferSelect;
type LineItem = typeof jobLineItems.$inferSelect;

function qboBase(env: Env): string {
  return env.QBO_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

async function pushQboInvoice(
  env: Env,
  conn: Connection,
  job: Job,
  customerName: string,
  items: LineItem[],
): Promise<string> {
  const base = qboBase(env);
  const headers = {
    Authorization: `Bearer ${conn.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  // Find-or-create the customer by display name
  const q = encodeURIComponent(
    `select * from Customer where DisplayName = '${customerName.replace(/'/g, "\\'")}'`,
  );
  const found = await fetch(`${base}/v3/company/${conn.externalRealmId}/query?query=${q}`, { headers });
  const foundJson = (await found.json()) as {
    QueryResponse?: { Customer?: { Id: string }[] };
  };
  let customerId = foundJson.QueryResponse?.Customer?.[0]?.Id;
  if (!customerId) {
    const created = await fetch(`${base}/v3/company/${conn.externalRealmId}/customer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ DisplayName: customerName }),
    });
    if (!created.ok) throw new Error(`QBO customer create failed: ${created.status}`);
    customerId = ((await created.json()) as { Customer: { Id: string } }).Customer.Id;
  }
  // ItemRef '1' is QBO's default "Services" item; map to a real item later.
  const res = await fetch(`${base}/v3/company/${conn.externalRealmId}/invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      CustomerRef: { value: customerId },
      Line: items.map((li) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: (li.quantity * li.unitPriceCents) / 100,
        Description: li.description,
        SalesItemLineDetail: {
          ItemRef: { value: '1' },
          Qty: li.quantity,
          UnitPrice: li.unitPriceCents / 100,
        },
      })),
      PrivateNote: `Pocket Ops job ${job.id}: ${job.title}`,
    }),
  });
  if (!res.ok) throw new Error(`QBO invoice push failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { Invoice: { Id: string } }).Invoice.Id;
}

async function pushXeroInvoice(
  conn: Connection,
  job: Job,
  customerName: string,
  items: LineItem[],
): Promise<string> {
  // AccountCode 200 is Xero's default sales account; map per-tenant later.
  const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      'Xero-tenant-id': conn.externalRealmId ?? '',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      Invoices: [
        {
          Type: 'ACCREC',
          Status: 'AUTHORISED',
          Contact: { Name: customerName },
          Reference: `Pocket Ops ${job.title}`,
          LineItems: items.map((li) => ({
            Description: li.description,
            Quantity: li.quantity,
            UnitAmount: li.unitPriceCents / 100,
            AccountCode: '200',
          })),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Xero invoice push failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { Invoices: { InvoiceID: string }[] };
  return json.Invoices[0]?.InvoiceID ?? 'unknown';
}
