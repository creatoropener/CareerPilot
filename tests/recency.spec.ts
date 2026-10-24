import { describe, expect, it } from 'vitest';
import { findPostedDate, hostMatches, isWithinWindow, WINDOW_DAYS } from '../lib/recency';

const now = new Date('2026-10-24T10:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe('findPostedDate', () => {
  it('prefers the provider date', () => {
    const found = findPostedDate({ publishedDate: daysAgo(2), text: 'Posted 20 days ago' }, now);
    expect(found?.source).toBe('api');
    expect(found?.date.toISOString()).toBe(daysAgo(2));
  });
  it('reads schema.org datePosted', () => {
    const found = findPostedDate({ text: '{"@type":"JobPosting","datePosted":"2026-10-20"}' }, now);
    expect(found?.source).toBe('structured-data');
    expect(found?.date.toISOString().slice(0, 10)).toBe('2026-10-20');
  });
  it('parses relative phrases and keeps the OLDEST match', () => {
    const found = findPostedDate({ text: 'Posted 3 days ago. Reviews: 2 weeks ago' }, now);
    expect(Math.round((now.getTime() - found!.date.getTime()) / 86_400_000)).toBe(14);
  });
  it('treats "30+ days ago" as older than 30 days', () => {
    const found = findPostedDate({ text: 'Posted 30+ days ago' }, now)!;
    expect(isWithinWindow(found.date, '4w', now)).toBe(false);
  });
  it('parses explicit "Posted on" dates, and ignores unrelated dates', () => {
    expect(findPostedDate({ text: 'Posted on 21 Oct 2026' }, now)?.date.toISOString().slice(0, 10)).toBe('2026-10-21');
    expect(findPostedDate({ text: 'Apply by 2026-11-30. Founded 2010.' }, now)).toBeNull();
  });
  it('treats zone-less ISO datetimes as UTC', () => {
    expect(findPostedDate({ publishedDate: '2026-10-23T08:30:00', text: '' }, now)?.date.toISOString()).toBe('2026-10-23T08:30:00.000Z');
  });
  it('returns null (not a guess) when no date exists, and rejects future dates', () => {
    expect(findPostedDate({ text: 'Supply Chain Manager, Mumbai. Apply now.' }, now)).toBeNull();
    expect(findPostedDate({ publishedDate: '2027-05-01', text: '' }, now)).toBeNull();
  });
});

describe('isWithinWindow', () => {
  it('has no all-time window and applies each boundary', () => {
    expect(Object.keys(WINDOW_DAYS)).toEqual(['1d', '1w', '2w', '3w', '4w']);
    expect(isWithinWindow(new Date(daysAgo(0.9)), '1d', now)).toBe(true);
    expect(isWithinWindow(new Date(daysAgo(1.1)), '1d', now)).toBe(false);
    expect(isWithinWindow(new Date(daysAgo(7)), '1w', now)).toBe(true);
    expect(isWithinWindow(new Date(daysAgo(8)), '1w', now)).toBe(false);
    expect(isWithinWindow(new Date(daysAgo(28)), '4w', now)).toBe(true);
    expect(isWithinWindow(new Date(daysAgo(29)), '4w', now)).toBe(false);
  });
});

describe('hostMatches', () => {
  it('matches the domain and its subdomains only', () => {
    expect(hostMatches('https://in.indeed.com/viewjob?jk=1', ['indeed.com'])).toBe(true);
    expect(hostMatches('https://www.naukri.com/job-listings-x', ['naukri.com'])).toBe(true);
    expect(hostMatches('https://notindeed.com/x', ['indeed.com'])).toBe(false);
    expect(hostMatches('https://indeed.com.evil.io/x', ['indeed.com'])).toBe(false);
    expect(hostMatches('not a url', ['indeed.com'])).toBe(false);
  });
});
