import { describe, expect, it } from 'vitest';
import {
  addSearch, afterCheck, afterRun, checkedLabel, createSearch, defaultName, keyOf, MAX_SAVED_SEARCHES, MAX_SEEN_KEYS,
  applySnapshot, newSince, rememberKeys, removeSearch, sameSearch, sanitizeSavedSearches, snapshotOf, totalNew,
} from '../src/lib/savedSearches';
import type { SearchSnapshot } from '../src/lib/savedSearches';
import { DEFAULT_PROFILE } from '../src/lib/types';

const now = new Date('2026-11-26T10:00:00Z');
const snap = (extra: Partial<SearchSnapshot> = {}): SearchSnapshot => ({
  targetRoles: 'Supply Chain Manager', skills: 'SAP, Excel', locations: ['Mumbai, India'], workMode: 'Any', timeWindow: '1w', sources: ['indeed', 'naukri'], companies: [], ...extra,
});

describe('identity of a search', () => {
  it('ignores order and capital letters, but not real differences', () => {
    expect(sameSearch(snap(), snap({ skills: 'excel; SAP', sources: ['naukri', 'indeed'], targetRoles: 'supply chain manager' }))).toBe(true);
    expect(sameSearch(snap(), snap({ timeWindow: '2w' }))).toBe(false);
    expect(sameSearch(snap(), snap({ locations: ['Pune, India'] }))).toBe(false);
    expect(sameSearch(snap(), snap({ companies: ['greenhouse:acme'] }))).toBe(false);
  });
  it('names a search after its first role and place', () => {
    expect(defaultName(snap())).toBe('Supply Chain Manager · Mumbai');
    expect(defaultName(snap({ locations: ['Mumbai, India', 'Pune, India'] }))).toBe('Supply Chain Manager · Mumbai +1');
    expect(defaultName(snap({ targetRoles: '', locations: [] }))).toBe('Job search');
  });
  it('uses the server key, or the link when there is none', () => {
    expect(keyOf({ key: 'abc', url: 'https://x.test/1' })).toBe('abc');
    expect(keyOf({ url: 'https://x.test/1' })).toBe('https://x.test/1');
  });
});

describe('new since last visit', () => {
  it('treats the results on screen at save time as already seen', () => {
    const saved = createSearch(snap(), ['a', 'b'], now);
    expect(saved.lastCheckedAt).toBeDefined();
    expect(newSince(saved, ['a', 'b', 'c'])).toEqual(['c']);
  });
  it('calls nothing new for a search that was never run (the first run is the baseline)', () => {
    const saved = createSearch(snap(), [], now);
    expect(saved.lastCheckedAt).toBeUndefined();
    expect(newSince(saved, ['a', 'b'])).toEqual([]);
    const checked = afterCheck(saved, ['a', 'b'], now);
    expect(checked.newCount).toBe(0);
    expect(newSince(checked, ['a', 'b', 'c'])).toEqual(['c']);
  });
  it('a background check counts new listings but leaves them unseen until you look', () => {
    const saved = createSearch(snap(), ['a'], now);
    const checked = afterCheck(saved, ['a', 'b', 'c'], now);
    expect(checked.newCount).toBe(2);
    expect(checked.seen).toEqual(['a']);
    expect(newSince(checked, ['a', 'b', 'c'])).toEqual(['b', 'c']);
    const viewed = afterRun(checked, ['a', 'b', 'c'], now);
    expect(viewed.newCount).toBe(0);
    expect(newSince(viewed, ['a', 'b', 'c', 'd'])).toEqual(['d']);
  });
  it('counts a repeated key once', () => {
    expect(newSince(createSearch(snap(), ['a'], now), ['b', 'b', 'a'])).toEqual(['b']);
  });
  it('remembers a limited number of keys, newest first', () => {
    const many = Array.from({ length: MAX_SEEN_KEYS + 40 }, (_, index) => `k${index}`);
    const kept = rememberKeys(['old'], many);
    expect(kept).toHaveLength(MAX_SEEN_KEYS);
    expect(kept[0]).toBe('k0');
    expect(kept).not.toContain('old');
  });
});

describe('the saved list', () => {
  it('keeps one entry for the same search, with its history', () => {
    const first = createSearch(snap(), ['a'], now);
    const again = createSearch(snap({ skills: 'excel, sap' }), ['a', 'b'], new Date(now.getTime() + 1000));
    const { list, outcome, id } = addSearch([first], again);
    expect(outcome).toBe('updated');
    expect(id).toBe(first.id);
    expect(list).toHaveLength(1);
    expect(list[0].seen).toEqual(expect.arrayContaining(['a', 'b']));
  });
  it('refuses a new search when the list is full instead of dropping one', () => {
    let list = [] as ReturnType<typeof createSearch>[];
    for (let index = 0; index < MAX_SAVED_SEARCHES; index += 1) {
      const result = addSearch(list, createSearch(snap({ targetRoles: `Role ${index}` }), ['a'], now));
      expect(result.outcome).toBe('added');
      list = result.list;
    }
    const full = addSearch(list, createSearch(snap({ targetRoles: 'One more' }), ['a'], now));
    expect(full.outcome).toBe('full');
    expect(full.list).toBe(list);
  });
  it('removes by id and totals the new listings', () => {
    const a = { ...createSearch(snap(), ['x'], now), newCount: 2 };
    const b = { ...createSearch(snap({ targetRoles: 'Buyer' }), ['x'], now), newCount: 3 };
    expect(totalNew([a, b])).toBe(5);
    expect(removeSearch([a, b], a.id)).toEqual([b]);
  });
});

describe('sanitizeSavedSearches', () => {
  it('keeps valid entries and drops malformed ones', () => {
    const good = createSearch(snap({ companies: ['greenhouse:acme'] }), ['a'], now);
    const stored = JSON.parse(JSON.stringify([
      good, null, 'x', 5, { id: 'no-search' }, { ...good, id: '', name: 'no id' }, { ...good, id: 'dup-a', search: { ...good.search, targetRoles: '' } },
      { ...good, id: 'bad-sources', search: { ...good.search, sources: ['not-a-site'] } },
      { ...good, id: 'dirty', name: '  Mine\u0000  ', newCount: -4, seen: ['k', 7, null], lastCheckedAt: 'yesterday', search: { ...good.search, timeWindow: 'all', workMode: 'Sideways', companies: ['https://evil.example/x', 'lever:ok'] } },
    ]));
    const result = sanitizeSavedSearches(stored);
    expect(result.map((entry) => entry.id)).toEqual([good.id, 'dirty']);
    const dirty = result[1];
    expect(dirty.name).toBe('Mine');
    expect(dirty.newCount).toBe(0);
    expect(dirty.seen).toEqual(['k']);
    expect(dirty.lastCheckedAt).toBeUndefined();
    expect(dirty.search).toMatchObject({ timeWindow: '1w', workMode: 'Any', companies: ['lever:ok'] });
  });
  it('handles anything that is not a list, and caps the list', () => {
    for (const value of [null, undefined, {}, 'x', 3]) expect(sanitizeSavedSearches(value)).toEqual([]);
    const many = Array.from({ length: 30 }, (_, index) => createSearch(snap({ targetRoles: `Role ${index}` }), [], now));
    expect(sanitizeSavedSearches(many)).toHaveLength(MAX_SAVED_SEARCHES);
  });
});

describe('checkedLabel', () => {
  it('says how long ago in plain words', () => {
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    expect(checkedLabel(undefined, now)).toBe('not run yet');
    expect(checkedLabel(ago(1), now)).toBe('checked just now');
    expect(checkedLabel(ago(30), now)).toBe('checked 30 min ago');
    expect(checkedLabel(ago(60), now)).toBe('checked 1 hour ago');
    expect(checkedLabel(ago(60 * 5), now)).toBe('checked 5 hours ago');
    expect(checkedLabel(ago(60 * 24 * 3), now)).toBe('checked 3 days ago');
  });
});

describe('snapshots', () => {
  it('copies only what decides a search, and applies it without touching the resume or education', () => {
    const profile = { ...DEFAULT_PROFILE, targetRoles: 'Buyer', skills: 'SAP', locations: ['Pune, India'], location: 'Pune, India', experienceSummary: 'private text', education: 'MBA', companies: ['lever:acme'] };
    const taken = snapshotOf(profile);
    expect(Object.keys(taken).sort()).toEqual(['companies', 'locations', 'skills', 'sources', 'targetRoles', 'timeWindow', 'workMode']);
    taken.locations.push('changed');
    expect(profile.locations).toEqual(['Pune, India']); // a copy, not a shared list
    const applied = applySnapshot(profile, snap({ locations: ['Mumbai, India', 'Goa, India'], targetRoles: 'Planner' }));
    expect(applied).toMatchObject({ targetRoles: 'Planner', location: 'Mumbai, India; Goa, India', experienceSummary: 'private text', education: 'MBA', companies: [] });
  });
});
