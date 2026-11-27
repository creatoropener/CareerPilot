import { describe, expect, it } from 'vitest';
import { canSearchMore, describeExclusions, MAX_BATCHES, PAGE_SIZE, revealNext, visibleAfterFetch, windowAge, describeFeeds } from '../src/lib/paging';

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

describe('describeFeeds', () => {
  it('says nothing when no company is followed', () => {
    expect(describeFeeds(undefined)).toBe('');
    expect(describeFeeds({ boards: 0, ok: 0, failed: 0, matched: 0 })).toBe('');
  });
  it('reports what was read, and what could not be', () => {
    expect(describeFeeds({ boards: 3, ok: 3, failed: 0, matched: 4 })).toBe(' Read 3 of 3 followed company boards: 4 matching openings.');
    expect(describeFeeds({ boards: 1, ok: 1, failed: 0, matched: 1 })).toBe(' Read 1 of 1 followed company board: 1 matching opening.');
    expect(describeFeeds({ boards: 3, ok: 2, failed: 1, matched: 0 })).toContain('1 board could not be reached.');
  });
});
