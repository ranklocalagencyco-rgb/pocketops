import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { sessions, users } from '../db/schema';
import { newId, newSessionToken, sha256Hex } from './ids';

export const SESSION_COOKIE = 'pocketops_session_token';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict' as const,
    path: '/',
    expires,
  };
}

export async function createSession(
  db: Db,
  opts: { tenantId: string; userId: string; ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: newId(),
    tokenHash: await sha256Hex(token),
    tenantId: opts.tenantId,
    userId: opts.userId,
    expiresAt,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
  });
  return { token, expiresAt };
}

export async function validateSessionToken(db: Db, token: string) {
  if (!token || token.length < 20 || token.length > 128) return null;
  const tokenHash = await sha256Hex(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  if (!row.user.isActive) return null;
  // Defense-in-depth: session and user tenant must agree
  if (row.session.tenantId !== row.user.tenantId) return null;
  return row;
}

export async function destroySessionByToken(db: Db, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
