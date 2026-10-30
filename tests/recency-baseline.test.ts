import test from 'node:test';
import assert from 'node:assert/strict';
import { findPostedDate, isWithinWindow, toDateOnly } from '../lib/recency.js';

// Baseline coverage for behaviour that already works and must keep working.
// Run by `npm test` (tsx --test tests/*.test.ts). Deliberately silent about the
// reported listing-age formats and about provider-date precedence.

const now = new Date('2026-10-24T10:00:00Z');
const DAY = 86_400_000;
const ageOf = (text: string): number | null => {
  const found = findPostedDate({ text }, now);
  return found ? now.getTime() - found.date.getTime() : null;
};

test('relative age: "Posted 3 days ago" is three days old', () => {
  assert.equal(ageOf('Posted 3 days ago'), 3 * DAY);
});

test('relative age: units hour, week and month', () => {
  assert.equal(ageOf('Posted 5 hours ago'), 5 * 3_600_000);
  assert.equal(ageOf('Posted 2 weeks ago'), 14 * DAY);
  assert.equal(ageOf('Posted 1 month ago'), 30 * DAY);
});

test('relative age: "30+ days ago" is read strictly as 31 days', () => {
  assert.equal(ageOf('Posted 30+ days ago'), 31 * DAY);
});

test('relative age: the oldest phrase wins', () => {
  assert.equal(ageOf('Posted 2 days ago. Reposted 9 days ago'), 9 * DAY);
});

test('keywords: just posted, posted today, posted yesterday', () => {
  assert.equal(ageOf('Just posted'), 0);
  assert.equal(ageOf('Posted today'), 0);
  assert.equal(ageOf('Posted yesterday'), DAY);
});

test('absolute dates: "Posted on 21 Oct 2026" and ISO dates', () => {
  const day = findPostedDate({ text: 'Posted on 21 Oct 2026' }, now);
  assert.equal(day && toDateOnly(day.date), '2026-10-21');
  const iso = findPostedDate({ text: 'Date posted: 2026-10-20' }, now);
  assert.equal(iso && toDateOnly(iso.date), '2026-10-20');
});

test('structured data: schema.org datePosted is read', () => {
  const found = findPostedDate({ text: '{"@type":"JobPosting","datePosted":"2026-10-18"}' }, now);
  assert.equal(found?.source, 'structured-data');
  assert.equal(found && toDateOnly(found.date), '2026-10-18');
});

test('text with no listing age gives no date (never guess)', () => {
  assert.equal(findPostedDate({ text: 'Senior Manager, Operations' }, now), null);
  assert.equal(findPostedDate({ text: 'Closes in 2 weeks' }, now), null);
  assert.equal(findPostedDate({ text: 'Founded 5 years ago' }, now), null);
  // A job title that merely contains digits and a letter is not a listing age.
  assert.equal(findPostedDate({ text: '3D printing technician' }, now), null);
});

test('window check: inside and outside the chosen window', () => {
  assert.equal(isWithinWindow(new Date(now.getTime() - 6 * DAY), '1w', now), true);
  assert.equal(isWithinWindow(new Date(now.getTime() - 8 * DAY), '1w', now), false);
});
