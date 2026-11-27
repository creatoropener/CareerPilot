import { describe, expect, it } from 'vitest';
import {
  addDays, awayLongEnough, countByStatus, countDue, daysBetween, filterSaved, followUpState, isDateOnly, localDateString,
  markApplied, orderSaved, sanitizeTracking, setStatus, toCsv, MAX_NOTES,
} from '../src/lib/tracker';
import type { ApplicationStatus, JobResult } from '../src/lib/types';

const job = (overrides: Partial<JobResult> = {}): JobResult => ({
  id: 'job-1', title: 'Supply Chain Manager — Acme', url: 'https://jobs.example.com/a-1', content: '', domain: 'jobs.example.com',
  matchScore: 72, matchedTerms: [], missingTerms: [], status: 'Saved', ...overrides,
});
const now = new Date(2026, 10, 25, 14, 30); // 25 Nov 2026, local time
const today = '2026-11-25';

describe('dates', () => {
  it('reads the local calendar day, adds days and counts the gap', () => {
    expect(localDateString(now)).toBe(today);
    expect(localDateString(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
    expect(addDays('2026-11-25', 7)).toBe('2026-12-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-11-25', '2026-11-28')).toBe(3);
    expect(daysBetween('2026-11-25', '2026-11-20')).toBe(-5);
  });
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isDateOnly('2026-02-28')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', null, 20260101]) expect(isDateOnly(bad)).toBe(false);
  });
});

describe('setStatus / markApplied', () => {
  it('records the application date and a follow-up a week later the first time a job is applied for', () => {
    const applied = markApplied(job(), now);
    expect(applied.status).toBe('Applied');
    expect(applied.appliedAt).toBe(now.toISOString());
    expect(applied.followUpAt).toBe('2026-12-02');
  });
  it('keeps an existing application date and follow-up', () => {
    const first = job({ status: 'Applied', appliedAt: '2026-11-01T00:00:00.000Z', followUpAt: '2026-11-10' });
    const again = markApplied(first, now);
    expect(again.appliedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(again.followUpAt).toBe('2026-11-10');
  });
  it('sets the date for later stages without inventing a reminder, and erases nothing when going back to Saved', () => {
    const interview = setStatus(job(), 'Interview', now);
    expect(interview.appliedAt).toBe(now.toISOString());
    expect(interview.followUpAt).toBeUndefined();
    const back = setStatus({ ...interview, notes: 'Called HR', followUpAt: '2026-12-01' }, 'Saved', now);
    expect(back).toMatchObject({ status: 'Saved', notes: 'Called HR', followUpAt: '2026-12-01', appliedAt: now.toISOString() });
  });
});

describe('followUpState', () => {
  const state = (followUpAt: string | undefined, status: ApplicationStatus = 'Applied') => followUpState({ status, followUpAt }, today);
  it('says when a follow-up is due, late or coming up', () => {
    expect(state('2026-11-25')).toMatchObject({ kind: 'today', label: 'Follow up today' });
    expect(state('2026-11-22')).toMatchObject({ kind: 'overdue', days: 3, label: 'Follow-up overdue by 3 days' });
    expect(state('2026-11-24')).toMatchObject({ kind: 'overdue', label: 'Follow-up overdue by 1 day' });
    expect(state('2026-11-26')).toMatchObject({ kind: 'upcoming', label: 'Follow up tomorrow' });
    expect(state('2026-12-02')).toMatchObject({ kind: 'upcoming', days: 7, label: 'Follow up in 7 days' });
  });
  it('has nothing to say without a date, with a bad date, or once the job is decided', () => {
    expect(state(undefined).kind).toBe('none');
    expect(state('soon').kind).toBe('none');
    expect(state('2026-11-01', 'Rejected').kind).toBe('none');
    expect(state('2026-11-01', 'Offer').kind).toBe('none');
  });
});

describe('saved list helpers', () => {
  const jobs = [
    job({ id: 'a', status: 'Saved' }),
    job({ id: 'b', status: 'Applied', followUpAt: '2026-11-25' }),
    job({ id: 'c', status: 'Applied', followUpAt: '2026-11-20' }),
    job({ id: 'd', status: 'Interview', followUpAt: '2026-12-10' }),
    job({ id: 'e', status: 'Rejected', followUpAt: '2026-11-01' }),
  ];
  it('puts due follow-ups first, most overdue on top, and keeps the rest in order', () => {
    expect(orderSaved(jobs, today).map((entry) => entry.id)).toEqual(['c', 'b', 'a', 'd', 'e']);
    expect(countDue(jobs, today)).toBe(2);
  });
  it('filters and counts by stage', () => {
    expect(filterSaved(jobs, 'Applied').map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(filterSaved(jobs, 'all')).toHaveLength(5);
    expect(countByStatus(jobs)).toEqual({ all: 5, Saved: 1, Applied: 2, Interview: 1, Offer: 0, Rejected: 1 });
  });
});

describe('sanitizeTracking', () => {
  it('keeps valid fields and drops the rest', () => {
    expect(sanitizeTracking({ appliedAt: '2026-11-01T10:00:00.000Z', followUpAt: '2026-11-08', notes: 'Spoke to Priya' }))
      .toEqual({ appliedAt: '2026-11-01T10:00:00.000Z', followUpAt: '2026-11-08', notes: 'Spoke to Priya' });
    expect(sanitizeTracking({ appliedAt: 'yesterday', followUpAt: '2026-02-30', notes: '   ' })).toEqual({});
    expect(sanitizeTracking(null)).toEqual({});
    expect(sanitizeTracking({ appliedAt: 5, followUpAt: 5, notes: 5 })).toEqual({});
  });
  it('limits notes to the maximum length and removes control characters', () => {
    expect(sanitizeTracking({ notes: 'x'.repeat(MAX_NOTES + 50) }).notes).toHaveLength(MAX_NOTES);
    expect(sanitizeTracking({ notes: 'a\u0000b\u0007c\nd' }).notes).toBe('a b c\nd');
  });
});

describe('awayLongEnough', () => {
  it('asks only after the user has really been away', () => {
    expect(awayLongEnough(null, 10_000, 8_000)).toBe(false);
    expect(awayLongEnough(1_000, 5_000, 8_000)).toBe(false);
    expect(awayLongEnough(1_000, 9_000, 8_000)).toBe(true);
  });
});

describe('toCsv', () => {
  it('writes one row per job with quoting, and shows formula-like cells as text', () => {
    const csv = toCsv([
      job({ title: 'Manager, "Supply Chain" — Acme', notes: 'line one\nline two', status: 'Applied', appliedAt: '2026-11-01T10:00:00.000Z', followUpAt: '2026-11-08', savedAt: '2026-10-30T00:00:00.000Z' }),
      job({ id: 'x', title: '=HYPERLINK("http://evil.example","click")', notes: '-5 on the test' }),
    ]).split('\r\n');
    expect(csv[0]).toBe('Title,Source,Link,Status,Match %,Posted,Saved,Applied,Follow-up,Notes');
    expect(csv[1]).toBe('"Manager, ""Supply Chain"" — Acme",jobs.example.com,https://jobs.example.com/a-1,Applied,72,,2026-10-30,2026-11-01,2026-11-08,"line one\nline two"');
    expect(csv).toHaveLength(3); // a line break inside a quoted cell does not start a new row
    expect(csv[2]).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csv[2]).toContain(`'-5 on the test`);
  });
});
