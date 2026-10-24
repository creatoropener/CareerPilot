// Time-window and portal options shared by the UI. Mirrors lib/recency.ts on the server.
// There is deliberately no "all time" option.
export type TimeWindowId = '1d' | '1w' | '2w' | '3w' | '4w';
export type SourceId = 'linkedin' | 'indeed' | 'glassdoor' | 'naukri' | 'ats';

export const TIME_WINDOWS: { id: TimeWindowId; label: string; days: number }[] = [
  { id: '1d', label: 'Last 1 day (24h)', days: 1 },
  { id: '1w', label: 'Last 1 week', days: 7 },
  { id: '2w', label: 'Last 2 weeks', days: 14 },
  { id: '3w', label: 'Last 3 weeks', days: 21 },
  { id: '4w', label: 'Last 4 weeks', days: 28 },
];

export const SOURCE_OPTIONS: { id: SourceId; label: string }[] = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'indeed', label: 'Indeed' },
  { id: 'glassdoor', label: 'Glassdoor' },
  { id: 'naukri', label: 'Naukri' },
  { id: 'ats', label: 'Company career sites (Greenhouse, Lever, Workday, Ashby)' },
];

export const DEFAULT_TIME_WINDOW: TimeWindowId = '1w';
export const DEFAULT_SOURCES: SourceId[] = ['linkedin', 'indeed', 'glassdoor', 'naukri', 'ats'];

export const isTimeWindowId = (value: unknown): value is TimeWindowId => TIME_WINDOWS.some((window) => window.id === value);
export const isSourceId = (value: unknown): value is SourceId => SOURCE_OPTIONS.some((source) => source.id === value);

export const windowLabel = (id: TimeWindowId): string => TIME_WINDOWS.find((window) => window.id === id)?.label.toLowerCase() ?? '';

/** True only when the listing has a valid posting date inside the window. Undated listings are never shown. */
export function isPostedWithin(publishedDate: string | null | undefined, id: TimeWindowId, now = new Date()): boolean {
  if (!publishedDate) return false;
  const posted = new Date(publishedDate);
  if (Number.isNaN(posted.getTime())) return false;
  const days = TIME_WINDOWS.find((window) => window.id === id)?.days ?? 0;
  const age = now.getTime() - posted.getTime();
  return age <= days * 86_400_000 && age >= -86_400_000;
}
