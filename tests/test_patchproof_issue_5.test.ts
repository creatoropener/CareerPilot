import test from 'node:test';
import assert from 'node:assert/strict';
import { findPostedDate } from '../lib/recency.js';

test('findPostedDate selects oldest evidence among provider date, structured data, and text', async () => {
  const fixedNow = new Date('2026-10-24T10:00:00Z');

  // Case 1: provider date recent, text says 30+ days ago → expect text (oldest)
  const input1 = { publishedDate: '2026-10-23T12:00:00Z', text: 'Posted 30+ days ago' };
  const result1 = findPostedDate(input1, fixedNow);
  assert.strictEqual(result1?.source, 'text');
  assert.strictEqual(result1?.date.toISOString(), '2026-09-23T10:00:00.000Z');

  // Case 2: structured data recent, text says 2 weeks ago → expect text (oldest)
  const input2 = { text: '{"datePosted":"2026-10-23"} Posted 2 weeks ago' };
  const result2 = findPostedDate(input2, fixedNow);
  assert.strictEqual(result2?.source, 'text');
  assert.strictEqual(result2?.date.toISOString(), '2026-10-10T10:00:00.000Z');

  // Case 3: provider date and text agree → expect provider date (api)
  const input3 = { publishedDate: '2026-10-04T10:00:00Z', text: 'Posted 2 days ago' };
  const result3 = findPostedDate(input3, fixedNow);
  assert.strictEqual(result3?.source, 'api');
  assert.strictEqual(result3?.date.toISOString(), '2026-10-04T10:00:00.000Z');

  // Case 4: only provider date present → expect provider date (api)
  const input4 = { publishedDate: '2026-10-22T10:00:00Z', text: 'Supply Chain Manager. Apply now.' };
  const result4 = findPostedDate(input4, fixedNow);
  assert.strictEqual(result4?.source, 'api');
  assert.strictEqual(result4?.date.toISOString(), '2026-10-22T10:00:00.000Z');
});
