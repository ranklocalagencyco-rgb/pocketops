/**
 * Quiet hours — automated texts (invoice chasers, recurring-service nudges,
 * review requests) only send inside the tenant's window, evaluated in the
 * tenant's timezone. Reactive messages (missed-call text-back, manual inbox
 * replies) are never gated: the customer just contacted us.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOfDay(hhmm: string | null | undefined, fallback: number): number {
  const m = hhmm ? HHMM.exec(hhmm) : null;
  return m ? +m[1] * 60 + +m[2] : fallback;
}

/** True when `now` falls inside the tenant's sending window. A window like
 *  20:00–08:00 (overnight) is handled; equal start/end means always allowed. */
export function withinSendingHours(
  tenant: { quietHoursStart: string | null; quietHoursEnd: string | null; timezone: string | null },
  now: Date = new Date(),
): boolean {
  const start = minutesOfDay(tenant.quietHoursStart, 8 * 60);
  const end = minutesOfDay(tenant.quietHoursEnd, 20 * 60);
  if (start === end) return true;

  let current: number;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tenant.timezone ?? 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => +(parts.find((p) => p.type === type)?.value ?? '0');
    current = (get('hour') % 24) * 60 + get('minute');
  } catch {
    current = now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  return start < end
    ? current >= start && current < end
    : current >= start || current < end; // overnight window
}
