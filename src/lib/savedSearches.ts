// Saved searches: a search you want to repeat, and a "new since you last looked" count for each. Pure and
// dependency-free (apart from types), so it is easy to test. Everything stays in this browser.
import { isSourceId } from '../../lib/sources';
import { sanitizeCompanies } from '../../lib/companies';
import { isTimeWindowId } from './window';
import type { TimeWindowId } from './window';
import type { CareerProfile, WorkMode } from './types';

export const MAX_SAVED_SEARCHES = 10;
/** Listing keys remembered for each saved search. The oldest are forgotten first. */
export const MAX_SEEN_KEYS = 300;

const WORK_MODES: WorkMode[] = ['Any', 'Remote', 'Hybrid', 'On-site'];

/** Everything that decides what a search finds. The resume and experience text are deliberately not part of it. */
export interface SearchSnapshot {
  targetRoles: string;
  skills: string;
  locations: string[];
  workMode: WorkMode;
  timeWindow: TimeWindowId;
  sources: string[];
  companies: string[];
}

export interface SavedSearch {
  id: string;
  name: string;
  createdAt: string;
  search: SearchSnapshot;
  /** Keys of the listings you have already been shown for this search. */
  seen: string[];
  /** When it was last run or checked. Absent until the first run. */
  lastCheckedAt?: string;
  /** Listings found by the last check that you have not been shown yet. */
  newCount: number;
}

const list = (value: string): string => value.split(/[\n,;|]/).map((part) => part.trim().toLowerCase()).filter(Boolean).sort().join('|');

/** A stable text for comparing two searches: order and capital letters do not matter. */
export function searchSignature(search: SearchSnapshot): string {
  return JSON.stringify([
    list(search.targetRoles), list(search.skills),
    search.locations.map((place) => place.trim().toLowerCase()).sort(), search.workMode, search.timeWindow,
    [...search.sources].sort(), [...search.companies].sort(),
  ]);
}

/** The part of a profile that decides what a search finds. */
export const snapshotOf = (profile: Pick<CareerProfile, 'targetRoles' | 'skills' | 'locations' | 'workMode' | 'timeWindow' | 'sources' | 'companies'>): SearchSnapshot => ({
  targetRoles: profile.targetRoles, skills: profile.skills, locations: [...profile.locations], workMode: profile.workMode,
  timeWindow: profile.timeWindow, sources: [...profile.sources], companies: [...profile.companies],
});

/** A profile that searches like the saved search. Resume, education and the rest of the profile are kept as they are. */
export const applySnapshot = (profile: CareerProfile, search: SearchSnapshot): CareerProfile => ({
  ...profile, ...search, sources: search.sources.filter(isSourceId), location: search.locations.join('; '),
});

export const sameSearch = (a: SearchSnapshot, b: SearchSnapshot): boolean => searchSignature(a) === searchSignature(b);

/** "Supply Chain Manager · Mumbai (+1)" from the first role and the first place. */
export function defaultName(search: SearchSnapshot): string {
  const role = search.targetRoles.split(/[\n,;|]/).map((part) => part.trim()).find(Boolean) ?? 'Job search';
  const place = search.locations[0]?.split(',')[0]?.trim();
  const more = search.locations.length > 1 ? ` +${search.locations.length - 1}` : '';
  return [role, place ? `${place}${more}` : ''].filter(Boolean).join(' · ').slice(0, 60);
}

/** Keys for a result list: the server's key when there is one, otherwise the link. */
export const keyOf = (job: { key?: string; url: string }): string => job.key || job.url;

/** Adds keys to the front of `seen` (most recent first), without repeats and within the limit. */
export function rememberKeys(seen: string[], keys: string[]): string[] {
  return [...new Set([...keys, ...seen])].slice(0, MAX_SEEN_KEYS);
}

/**
 * The listings in `keys` you have not seen for this search. A search that was never run has nothing to compare with,
 * so nothing is called new: the first run sets the baseline.
 */
export function newSince(saved: SavedSearch, keys: string[]): string[] {
  if (!saved.lastCheckedAt) return [];
  const seen = new Set(saved.seen);
  return [...new Set(keys)].filter((key) => !seen.has(key));
}

/** After you have been shown the results: they all count as seen and the "new" count goes back to zero. */
export function afterRun(saved: SavedSearch, keys: string[], now = new Date()): SavedSearch {
  return { ...saved, seen: rememberKeys(saved.seen, keys), newCount: 0, lastCheckedAt: now.toISOString() };
}

/** After a background check: only the count changes. The listings stay "new" until you actually look at them. */
export function afterCheck(saved: SavedSearch, keys: string[], now = new Date()): SavedSearch {
  return { ...saved, newCount: newSince(saved, keys).length, lastCheckedAt: saved.lastCheckedAt ?? now.toISOString(), ...(saved.lastCheckedAt ? {} : { seen: rememberKeys(saved.seen, keys) }) };
}

export function createSearch(search: SearchSnapshot, keys: string[], now = new Date(), name?: string): SavedSearch {
  return {
    id: `ss-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: (name ?? '').trim().slice(0, 60) || defaultName(search),
    createdAt: now.toISOString(),
    search,
    seen: rememberKeys([], keys),
    // Saved from results that are on screen: those are already seen, so only later finds are new.
    ...(keys.length > 0 ? { lastCheckedAt: now.toISOString() } : {}),
    newCount: 0,
  };
}

export type AddOutcome = 'added' | 'updated' | 'full';

/** The same search saved twice keeps one entry (and its history). A full list is never trimmed silently. */
export function addSearch(current: SavedSearch[], next: SavedSearch): { list: SavedSearch[]; outcome: AddOutcome; id: string } {
  const existing = current.find((entry) => sameSearch(entry.search, next.search));
  if (existing) {
    return { list: current.map((entry) => entry.id === existing.id ? { ...entry, seen: rememberKeys(entry.seen, next.seen), newCount: 0, lastCheckedAt: next.lastCheckedAt ?? entry.lastCheckedAt } : entry), outcome: 'updated', id: existing.id };
  }
  if (current.length >= MAX_SAVED_SEARCHES) return { list: current, outcome: 'full', id: '' };
  return { list: [next, ...current], outcome: 'added', id: next.id };
}

export const removeSearch = (current: SavedSearch[], id: string): SavedSearch[] => current.filter((entry) => entry.id !== id);

export const totalNew = (current: SavedSearch[]): number => current.reduce((sum, entry) => sum + entry.newCount, 0);

// ---- stored values ------------------------------------------------------------------------------------------

const strings = (value: unknown, max: number): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 120)).slice(0, max)
  : [];

const text = (value: unknown, max: number): string => typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '';

function sanitizeSnapshot(value: unknown): SearchSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const targetRoles = text(source.targetRoles, 500);
  const sources = [...new Set(strings(source.sources, 20).filter(isSourceId))];
  if (!targetRoles || sources.length === 0) return null;
  return {
    targetRoles,
    skills: text(source.skills, 500),
    locations: strings(source.locations, 5),
    workMode: WORK_MODES.includes(source.workMode as WorkMode) ? source.workMode as WorkMode : 'Any',
    timeWindow: isTimeWindowId(source.timeWindow) ? source.timeWindow : '1w',
    sources,
    companies: sanitizeCompanies(source.companies, 8),
  };
}

/** Keeps only valid saved searches from stored or imported data. Anything malformed is dropped. */
export function sanitizeSavedSearches(value: unknown): SavedSearch[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const result: SavedSearch[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const search = sanitizeSnapshot(item.search);
    const id = text(item.id, 60);
    if (!search || !id || ids.has(id)) continue;
    ids.add(id);
    const checked = typeof item.lastCheckedAt === 'string' && !Number.isNaN(Date.parse(item.lastCheckedAt)) ? item.lastCheckedAt : undefined;
    const created = typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : new Date(0).toISOString();
    const newCount = typeof item.newCount === 'number' && Number.isFinite(item.newCount) ? Math.max(0, Math.min(999, Math.floor(item.newCount))) : 0;
    result.push({
      id, search, createdAt: created, name: text(item.name, 60) || defaultName(search),
      seen: strings(item.seen, MAX_SEEN_KEYS).map((key) => key.slice(0, 300)), newCount, ...(checked ? { lastCheckedAt: checked } : {}),
    });
    if (result.length === MAX_SAVED_SEARCHES) break;
  }
  return result;
}

/** "checked 3 hours ago" for the list. */
export function checkedLabel(lastCheckedAt: string | undefined, now = new Date()): string {
  if (!lastCheckedAt) return 'not run yet';
  const minutes = Math.round((now.getTime() - Date.parse(lastCheckedAt)) / 60_000);
  if (Number.isNaN(minutes) || minutes < 2) return 'checked just now';
  if (minutes < 60) return `checked ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `checked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `checked ${days} ${days === 1 ? 'day' : 'days'} ago`;
}
