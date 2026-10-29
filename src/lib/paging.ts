// Paging rules for the job list: 10 listings at a time, and a "Search More Jobs" button that never loops.
import type { SearchExclusions } from './types';

/** Listings shown per batch. */
export const PAGE_SIZE = 10;
/** Maximum number of different provider searches for one profile (the first search plus "Search More Jobs"). */
export const MAX_BATCHES = 4;

export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** How many listings to show after "Search More Jobs" reveals listings that were already found. */
export const revealNext = (total: number, visible: number): number => Math.min(total, visible + PAGE_SIZE);

/** How many listings to show after a new search added `fresh` listings: at most 10 new ones per click. */
export const visibleAfterFetch = (existing: number, fresh: number): number => existing + Math.min(fresh, PAGE_SIZE);

/** True while the button should be offered: unseen results are waiting, or one more bounded search is allowed. */
export function canSearchMore(state: { total: number; visible: number; batch: number; exhausted: boolean }): boolean {
  if (state.total > state.visible) return true;
  return state.total > 0 && !state.exhausted && state.batch < MAX_BATCHES;
}

/** One consistent explanation of why results were left out. Only reasons that actually applied are listed. */
export function describeExclusions(ex: Partial<SearchExclusions> | undefined, windowText: string): string {
  if (!ex) return '';
  const parts = [
    ex.notVacancy ? plural(ex.notVacancy, 'search or category page') : '',
    ex.wrongLocation ? `${plural(ex.wrongLocation, 'listing')} for other places` : '',
    ex.undated ? `${ex.undated} without a verifiable posting date` : '',
    ex.tooOld ? `${ex.tooOld} older than ${windowText}` : '',
  ].filter(Boolean);
  return parts.length ? ` Left out: ${parts.join(', ')}.` : '';
}

/** "last 1 week" -> "1 week"; "last 1 day (24h)" -> "1 day". Used in "older than 1 week". */
export const windowAge = (windowId: string): string => ({ '1d': '1 day', '1w': '1 week', '2w': '2 weeks', '3w': '3 weeks', '4w': '4 weeks' } as Record<string, string>)[windowId] ?? windowId;
