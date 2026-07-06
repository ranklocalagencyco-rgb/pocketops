import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import { passwordResets, users } from '../db/schema';
import { newId, newPasswordResetToken, sha256Hex } from './ids';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function createPasswordReset(
  db: Db,
  user: { id: string; tenantId: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newPasswordResetToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.insert(passwordResets).values({
    id: newId(),
    tokenHash: await sha256Hex(token),
    tenantId: user.tenantId,
    userId: user.id,
    expiresAt,
  });
  return { token, expiresAt };
}

/** Looks up an unused, unexpired reset token. Does not consume it. */
export async function findPasswordReset(db: Db, token: string) {
  if (!token || token.length < 20 || token.length > 128) return null;
  const tokenHash = await sha256Hex(token);
  const rows = await db
    .select({ reset: passwordResets, user: users })
    .from(passwordResets)
    .innerJoin(users, eq(passwordResets.userId, users.id))
    .where(
      and(
        eq(passwordResets.tokenHash, tokenHash),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function consumePasswordReset(db: Db, resetId: string): Promise<void> {
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, resetId));
}
