import { describe, expect, it } from 'vitest';
import { canSearchMore, describeExclusions, MAX_BATCHES, PAGE_SIZE, revealNext, visibleAfterFetch, windowAge } from '../src/lib/paging';

describe('paging', () => {
  it('shows 10 at a time', () => {
    expect(PAGE_SIZE).toBe(10);
    expect(revealNext(27, 10)).toBe(20);
    expect(revealNext(27, 20)).toBe(27);
  });
  it('adds at most 10 new listings per "Search More Jobs" search', () => {
    expect(visibleAfterFetch(4, 30)).toBe(14);
    expect(visibleAfterFetch(10, 3)).toBe(13);
  });
  it('offers the button while listings are waiting or one more bounded search is allowed, never forever', () => {
    expect(canSearchMore({ total: 27, visible: 10, batch: 1, exhausted: false })).toBe(true);
    expect(canSearchMore({ total: 10, visible: 10, batch: 1, exhausted: false })).toBe(true);
    expect(canSearchMore({ total: 4, visible: 10, batch: 1, exhausted: false })).toBe(true);
    expect(canSearchMore({ total: 10, visible: 10, batch: MAX_BATCHES, exhausted: false })).toBe(false);
    expect(canSearchMore({ total: 10, visible: 10, batch: 2, exhausted: true })).toBe(false);
    expect(canSearchMore({ total: 0, visible: 10, batch: 1, exhausted: false })).toBe(false);
  });
  it('words the window as an age', () => {
    expect(windowAge('1d')).toBe('1 day');
    expect(windowAge('4w')).toBe('4 weeks');
  });
  it('explains what was left out, naming only the reasons that applied', () => {
    expect(describeExclusions({ notVacancy: 12, wrongLocation: 1, undated: 0, tooOld: 4 }, '1 week'))
      .toBe(' Left out: 12 search or category pages, 1 listing for other places, 4 older than 1 week.');
    expect(describeExclusions({ notVacancy: 0, wrongLocation: 0, undated: 0, tooOld: 0 }, 'week')).toBe('');
    expect(describeExclusions(undefined, 'week')).toBe('');
  });
});
