/**
 * Margin & Cost Masking Framework.
 *
 * Masking is structural: sensitive keys are deleted server-side before a row
 * is rendered or serialized for technician/apprentice roles. Never rely on
 * hiding these values with CSS or client-side logic.
 */
import type { UserRole } from '../db/schema';

export const FINANCIALLY_PRIVILEGED_ROLES: readonly UserRole[] = ['owner', 'admin'];

/** Column keys (camelCase, post-Drizzle) that carry margin/cost data. */
export const SENSITIVE_KEYS = [
  'unitCostCents',
  'hourlyCostCents',
  'costCents',
  'marginCents',
  'accessToken',
  'refreshToken',
  'passwordHash',
] as const;

export type SensitiveKey = (typeof SENSITIVE_KEYS)[number];
export type Masked<T> = Omit<T, SensitiveKey>;

export function canSeeFinancials(role: UserRole): boolean {
  return FINANCIALLY_PRIVILEGED_ROLES.includes(role);
}

/** Always strips sensitive keys, regardless of role. */
export function stripFinancials<T extends object>(row: T): Masked<T> {
  const copy = { ...row } as Record<string, unknown>;
  for (const key of SENSITIVE_KEYS) delete copy[key];
  return copy as Masked<T>;
}

/**
 * Role-aware view of a row. Owners/admins get the full row; technicians and
 * apprentices get the masked shape. The union return type forces callers to
 * handle the masked case in templates.
 */
export function forRole<T extends object>(row: T, role: UserRole): T | Masked<T> {
  return canSeeFinancials(role) ? row : stripFinancials(row);
}

export function forRoleAll<T extends object>(rows: T[], role: UserRole): (T | Masked<T>)[] {
  return canSeeFinancials(role) ? rows : rows.map(stripFinancials);
}
