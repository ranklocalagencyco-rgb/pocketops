/**
 * Characterisation test: pins the job pipeline exactly as it behaves today.
 * If this fails, a transition was added or removed — make sure that was intended.
 */
import { describe, expect, it } from 'vitest';
import { JOB_STATUSES, type JobStatus } from '../../src/db/schema';
import { canTransition, TRANSITIONS } from '../../src/lib/jobs';

const EXPECTED: Record<JobStatus, JobStatus[]> = {
  lead: ['quoted', 'cancelled'],
  quoted: ['approved', 'cancelled'],
  approved: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['invoiced'],
  invoiced: ['paid', 'cancelled'],
  paid: [],
  cancelled: ['lead'],
};

describe('job status transitions', () => {
  it('has a rule for every status and no others', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...JOB_STATUSES].sort());
  });

  it('matches the current pipeline exactly', () => {
    expect(TRANSITIONS).toEqual(EXPECTED);
  });

  const pairs = JOB_STATUSES.flatMap((from) => JOB_STATUSES.map((to) => [from, to] as const));
  it.each(pairs)('%s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(EXPECTED[from].includes(to));
  });

  it('never allows a status to transition to itself', () => {
    for (const s of JOB_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('treats paid as final', () => {
    expect(JOB_STATUSES.filter((to) => canTransition('paid', to))).toEqual([]);
  });

  it('rejects an unknown status instead of throwing', () => {
    expect(canTransition('bogus' as JobStatus, 'lead')).toBe(false);
  });
});
