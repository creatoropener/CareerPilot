import { describe, expect, it } from 'vitest';
import { findPostedDate, hostMatches, isWithinWindow, WINDOW_DAYS } from '../lib/recency';

const now = new Date('2026-10-24T10:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe('findPostedDate', () => {
  it('uses the provider date when the page does not contradict it', () => {
    const found = findPostedDate({ publishedDate: daysAgo(2), text: 'Supply Chain Manager, Mumbai. Apply now.' }, now);
    expect(found?.source).toBe('api');
    expect(found?.date.toISOString()).toBe(daysAgo(2));
  });
  it('keeps the provider date when the page agrees within a day', () => {
    const found = findPostedDate({ publishedDate: daysAgo(2), text: 'Posted 3 days ago' }, now);
    expect(found?.source).toBe('api');
  });
  it('lets an older "Posted N days ago" on the page override a newer provider date', () => {
    const found = findPostedDate({ publishedDate: daysAgo(2), text: 'Posted 20 days ago' }, now);
    expect(found?.source).toBe('text');
    expect(found?.date.toISOString()).toBe(daysAgo(20));
    expect(isWithinWindow(found!.date, '1w', now)).toBe(false);
  });
  it('lets an older "Posted on" date or datePosted override the provider date', () => {
    expect(findPostedDate({ publishedDate: daysAgo(1), text: 'Posted on 1 Oct 2026' }, now)?.date.toISOString().slice(0, 10)).toBe('2026-10-01');
    const structured = findPostedDate({ publishedDate: daysAgo(1), text: '{"datePosted":"2026-09-20"}' }, now);
    expect(structured?.source).toBe('structured-data');
    expect(structured?.date.toISOString().slice(0, 10)).toBe('2026-09-20');
  });
  it('does not let an unrelated "2 weeks ago" (a review, a closing date) override the provider date', () => {
    const found = findPostedDate({ publishedDate: daysAgo(2), text: 'Reviews: 2 weeks ago. Closes in 3 weeks.' }, now);
    expect(found?.source).toBe('api');
  });
  it('reads "a month ago", "an hour ago" and "over a month ago"', () => {
    const age = (text: string) => Math.round((now.getTime() - findPostedDate({ text }, now)!.date.getTime()) / 3_600_000);
    expect(age('Posted a month ago')).toBe(30 * 24);
    expect(age('Posted an hour ago')).toBe(1);
    expect(age('Posted one week ago')).toBe(7 * 24);
    expect(age('Posted over a month ago')).toBe(31 * 24);
    expect(isWithinWindow(findPostedDate({ text: 'Posted over a month ago' }, now)!.date, '4w', now)).toBe(false);
  });
  it('reads compact ages such as 3d, 5h, 2w, 1mo and 30d+', () => {
    const days = (text: string) => ((now.getTime() - findPostedDate({ text }, now)!.date.getTime()) / 86_400_000);
    expect(days('Acme Logistics | Mumbai | 3d')).toBe(3);
    expect(days('Posted 2w')).toBe(14);
    expect(days('Active 1mo ago')).toBe(30);
    expect(days('Posted 30d+')).toBe(31);
    expect(days('Operations Manager\n5h')).toBeCloseTo(5 / 24, 5);
    expect(isWithinWindow(findPostedDate({ text: 'Posted 30d+' }, now)!.date, '4w', now)).toBe(false);
  });
  it('does not read job titles or product names as compact ages', () => {
    for (const text of ['3D printing technician', '3d printing technician', 'Posted: 3D printing technician', '2D, 3D graphics', '5w-40 engine oil', 'Closes in 2 weeks', 'Founded 5 years ago']) {
      expect(findPostedDate({ text }, now)).toBeNull();
    }
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
