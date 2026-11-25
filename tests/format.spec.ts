import { describe, expect, it } from 'vitest';
import { ageLabel } from '../src/lib/format';
import { describeFailures } from '../src/lib/paging';

const now = new Date('2026-11-25T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const HOUR = 3_600_000;

describe('ageLabel', () => {
  it('describes recent postings in plain words', () => {
    expect(ageLabel(ago(10 * 60_000), now)).toBe('just now');
    expect(ageLabel(ago(HOUR), now)).toBe('1 hour ago');
    expect(ageLabel(ago(5 * HOUR), now)).toBe('5 hours ago');
    expect(ageLabel(ago(30 * HOUR), now)).toBe('yesterday');
    expect(ageLabel(ago(5 * 24 * HOUR), now)).toBe('5 days ago');
    expect(ageLabel(ago(21 * 24 * HOUR), now)).toBe('3 weeks ago');
  });
  it('returns null for a missing or invalid date and never shows a negative age', () => {
    expect(ageLabel(undefined, now)).toBeNull();
    expect(ageLabel('not a date', now)).toBeNull();
    expect(ageLabel(new Date(now.getTime() + HOUR).toISOString(), now)).toBe('just now');
  });
});

describe('describeFailures', () => {
  it('says nothing when every search worked, and warns when some failed', () => {
    expect(describeFailures(0, 5)).toBe('');
    expect(describeFailures(undefined, 5)).toBe('');
    expect(describeFailures(2, 8)).toContain('2 of 8 searches failed');
  });
});
