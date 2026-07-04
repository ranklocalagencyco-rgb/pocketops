/**
 * Unified email inbox — Gmail + Outlook (Microsoft Graph) over plain fetch.
 * Inbound mail from known customers lands in the same `messages` threads as
 * SMS; replies send from the connected mailbox. All isolate-safe.
 */
import { eq } from 'drizzle-orm';
import { tenantValues, tenantWhere, type Db } from '../db';
import { customers, emailAccounts, messages } from '../db/schema';
import { newId } from './ids';
import { logMessage } from './messages';

export type EmailProvider = 'gmail' | 'outlook';

interface EmailProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
  extraAuthParams: Record<string, string>;
  clientId: (env: Env) => string | undefined;
  clientSecret: (env: Env) => string | undefined;
}

export const EMAIL_PROVIDERS: Record<EmailProvider, EmailProviderConfig> = {
  gmail: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: 'https://www.googleapis.com/auth/gmail.modify',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
  },
  outlook: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'offline_access Mail.Read Mail.Send User.Read',
    extraAuthParams: { response_mode: 'query' },
    clientId: (env) => env.MS_CLIENT_ID,
    clientSecret: (env) => env.MS_CLIENT_SECRET,
  },
};

export function isEmailProvider(v: string): v is EmailProvider {
  return v === 'gmail' || v === 'outlook';
}

export function emailProviderConfigured(provider: EmailProvider, env: Env): boolean {
  const cfg = EMAIL_PROVIDERS[provider];
  return Boolean(cfg.clientId(env) && cfg.clientSecret(env));
}

export function buildEmailAuthorizeUrl(
  provider: EmailProvider,
  env: Env,
  redirectUri: string,
  state: string,
): string {
  const cfg = EMAIL_PROVIDERS[provider];
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set('client_id', cfg.clientId(env) ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scopes);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(cfg.extraAuthParams)) url.searchParams.set(k, v);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(
  provider: EmailProvider,
  env: Env,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const cfg = EMAIL_PROVIDERS[provider];
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId(env) ?? '',
      client_secret: cfg.clientSecret(env) ?? '',
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`${provider} token request failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

export function exchangeEmailCode(
  provider: EmailProvider,
  env: Env,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  return tokenRequest(provider, env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
}

export async function fetchMailboxAddress(
  provider: EmailProvider,
  accessToken: string,
): Promise<string | null> {
  if (provider === 'gmail') {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { emailAddress?: string }).emailAddress ?? null;
  }
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const me = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return me.mail ?? me.userPrincipalName ?? null;
}

type EmailAccount = typeof emailAccounts.$inferSelect;

async function freshAccount(db: Db, env: Env, account: EmailAccount): Promise<EmailAccount> {
  const expiresSoon =
    !account.tokenExpiresAt || account.tokenExpiresAt.getTime() < Date.now() + 60_000;
  if (!expiresSoon) return account;
  const tokens = await tokenRequest(account.provider, env, {
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
  });
  const patch = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? account.refreshToken,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    updatedAt: new Date(),
  };
  await db
    .update(emailAccounts)
    .set(patch)
    .where(tenantWhere(emailAccounts, account.tenantId, eq(emailAccounts.id, account.id)));
  return { ...account, ...patch };
}

// --- base64url helpers (Gmail raw messages) ---
function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function extractAddress(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1]! : fromHeader).trim().toLowerCase();
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
function gmailPlainText(part: GmailPart): string | null {
  if (part.mimeType === 'text/plain' && part.body?.data) return b64urlDecode(part.body.data);
  for (const p of part.parts ?? []) {
    const t = gmailPlainText(p);
    if (t) return t;
  }
  return null;
}

/**
 * Pull recent inbox mail. Only senders matching a customer's email are
 * ingested — keeps newsletters and spam out of the work inbox.
 */
export async function syncEmailAccount(db: Db, env: Env, account: EmailAccount): Promise<number> {
  const acc = await freshAccount(db, env, account);
  const auth = { Authorization: `Bearer ${acc.accessToken}` };
  const tenantId = acc.tenantId;

  const known = await db
    .select({ id: customers.id, email: customers.email })
    .from(customers)
    .where(tenantWhere(customers, tenantId));
  const byEmail = new Map(
    known.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]),
  );

  type Incoming = { extId: string; from: string; subject: string; body: string; at: Date };
  const incoming: Incoming[] = [];

  if (acc.provider === 'gmail') {
    const list = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Ainbox%20newer_than%3A7d&maxResults=20',
      { headers: auth },
    );
    if (!list.ok) throw new Error(`Gmail list failed: ${list.status}`);
    const ids = ((await list.json()) as { messages?: { id: string }[] }).messages ?? [];
    for (const { id } of ids) {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: auth },
      );
      if (!res.ok) continue;
      const msg = (await res.json()) as {
        id: string;
        internalDate?: string;
        snippet?: string;
        payload?: GmailPart & { headers?: { name: string; value: string }[] };
      };
      const header = (n: string) =>
        msg.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? '';
      incoming.push({
        extId: msg.id,
        from: extractAddress(header('from')),
        subject: header('subject'),
        body: (msg.payload ? gmailPlainText(msg.payload) : null) ?? msg.snippet ?? '',
        at: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
      });
    }
  } else {
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=20&$select=id,from,subject,bodyPreview,receivedDateTime',
      { headers: auth },
    );
    if (!res.ok) throw new Error(`Graph list failed: ${res.status}`);
    const json = (await res.json()) as {
      value: {
        id: string;
        subject?: string;
        bodyPreview?: string;
        receivedDateTime?: string;
        from?: { emailAddress?: { address?: string } };
      }[];
    };
    for (const m of json.value ?? []) {
      incoming.push({
        extId: m.id,
        from: (m.from?.emailAddress?.address ?? '').toLowerCase(),
        subject: m.subject ?? '',
        body: m.bodyPreview ?? '',
        at: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
      });
    }
  }

  let ingested = 0;
  for (const mail of incoming) {
    const customerId = byEmail.get(mail.from);
    if (!customerId || !mail.body) continue;
    const [dupe] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(tenantWhere(messages, tenantId, eq(messages.twilioSid, mail.extId)))
      .limit(1);
    if (dupe) continue;
    await db.insert(messages).values(
      tenantValues(tenantId, {
        id: newId(),
        customerId,
        direction: 'in' as const,
        kind: 'email' as const,
        phone: mail.from,
        subject: mail.subject.slice(0, 200) || null,
        body: mail.body.slice(0, 4000),
        twilioSid: mail.extId,
        createdAt: mail.at,
      }),
    );
    ingested++;
  }

  await db
    .update(emailAccounts)
    .set({ lastSyncedAt: new Date(), status: 'active' })
    .where(tenantWhere(emailAccounts, tenantId, eq(emailAccounts.id, acc.id)));
  return ingested;
}

/** Send from the connected mailbox and log into the thread. */
export async function sendAndLogEmail(
  db: Db,
  env: Env,
  account: EmailAccount,
  opts: { to: string; subject: string; text: string; customerId?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const acc = await freshAccount(db, env, account);
    if (acc.provider === 'gmail') {
      const raw = b64urlEncode(
        `From: ${acc.emailAddress}\r\nTo: ${opts.to}\r\nSubject: ${opts.subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${opts.text}`,
      );
      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${acc.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }),
        },
      );
      if (!res.ok) return { ok: false, error: `Gmail send failed: ${res.status}` };
    } else {
      const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: { Authorization: `Bearer ${acc.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: opts.subject,
            body: { contentType: 'Text', content: opts.text },
            toRecipients: [{ emailAddress: { address: opts.to } }],
          },
          saveToSentItems: true,
        }),
      });
      if (!res.ok) return { ok: false, error: `Outlook send failed: ${res.status}` };
    }
    await logMessage(db, account.tenantId, {
      direction: 'out',
      kind: 'email',
      phone: opts.to.toLowerCase(),
      subject: opts.subject,
      body: opts.text,
      customerId: opts.customerId,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
