import test from 'node:test';
import assert from 'node:assert/strict';
import { findPostedDate } from '../lib/recency';

// Fixed clock so every expectation below is exact.
const now = new Date('2026-10-24T10:00:00Z');

test('provider date does not hide an older "Posted N days ago" phrase in the listing text', () => {
  const found = findPostedDate({ publishedDate: '2026-10-23T12:00:00Z', text: 'Posted 30+ days ago' }, now);
  assert.equal(found?.date.toISOString(), '2026-09-23T10:00:00.000Z');
  assert.equal(found?.source, 'text');
});

test('schema.org datePosted does not hide an older "Posted N weeks ago" phrase in the listing text', () => {
  const found = findPostedDate({ text: '{"datePosted":"2026-10-23"} Posted 2 weeks ago' }, now);
  assert.equal(found?.date.toISOString(), '2026-10-10T10:00:00.000Z');
  assert.equal(found?.source, 'text');
});

test('with several relative phrases the oldest one still wins', () => {
  const found = findPostedDate({ text: 'Posted 3 days ago. Reviews: 2 weeks ago' }, now);
  assert.equal(found?.date.toISOString(), '2026-10-10T10:00:00.000Z');
  assert.equal(found?.source, 'text');
});

test('provider date is still used when the text has no age phrase', () => {
  const found = findPostedDate({ publishedDate: '2026-10-22T08:00:00Z', text: 'Supply Chain Manager, Mumbai. Apply now.' }, now);
  assert.equal(found?.date.toISOString(), '2026-10-22T08:00:00.000Z');
  assert.equal(found?.source, 'api');
});

test('schema.org datePosted is still used when the text has no age phrase', () => {
  const found = findPostedDate({ text: '{"@type":"JobPosting","datePosted":"2026-10-20"}' }, now);
  assert.equal(found?.date.toISOString(), '2026-10-20T00:00:00.000Z');
  assert.equal(found?.source, 'structured-data');
});

test('no date anywhere still returns null', () => {
  assert.equal(findPostedDate({ text: 'Supply Chain Manager, Mumbai. Apply now.' }, now), null);
});
